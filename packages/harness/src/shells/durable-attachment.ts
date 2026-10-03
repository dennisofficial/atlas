import { closeSync, constants, openSync, readSync, statSync } from 'node:fs'

import { EKilledBy, EShellStatus } from '@dltech/atlas-core'

import type { ShellInputOutcome } from './background-shell'
import { EExitCause, type ControlResult, type DurableShellHandle, type ExitRecord } from './durable/client'
import type { ShellAttachment, ShellExit } from './port'
import { toShellId } from './shell-id'
import type { ShellFiles } from './storage'

export const sizeOf = (path: string): number => {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

const readRange = (args: { path: string; start: number; limit: number }): Uint8Array => {
  const buffer = new Uint8Array(args.limit)
  let descriptor: number
  try {
    descriptor = openSync(args.path, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch (error) {
    throw new Error(`could not read the shell's output spool: ${String(error)}`)
  }
  try {
    const read = readSync(descriptor, buffer, 0, args.limit, args.start)
    return buffer.subarray(0, read)
  } finally {
    closeSync(descriptor)
  }
}

export function exitOf(args: {
  exit: ExitRecord
  killedBy: EKilledBy | undefined
  endedAt: string
}): ShellExit {
  const { exit } = args
  const base = { exitCode: exit.exitCode, endedAt: args.endedAt, totalBytes: exit.spoolBytes }
  switch (exit.cause) {
    case EExitCause.Natural:
      return { ...base, status: EShellStatus.Exited }
    case EExitCause.OutputLimit:
      return { ...base, status: EShellStatus.Overflowed }
    case EExitCause.Timeout:
    case EExitCause.Silence:
      return { ...base, status: EShellStatus.Killed, killedBy: EKilledBy.Timeout }
    case EExitCause.Expired:
      return { ...base, status: EShellStatus.Killed, killedBy: EKilledBy.SessionEnd }
    case EExitCause.Terminated:
    case EExitCause.Killed:
      return { ...base, status: EShellStatus.Killed, killedBy: args.killedBy ?? EKilledBy.Unrecorded }
  }
}

export function attachmentOf(args: {
  handle: DurableShellHandle
  files: ShellFiles
  shellId: string
  startedAt: string
}): ShellAttachment {
  const { handle, files } = args
  let killedBy: EKilledBy | undefined
  let generation = 0

  const reply = (result: ControlResult): ShellInputOutcome =>
    result.ok ? { ok: true } : { ok: false, reason: result.message }

  return {
    shellId: toShellId(args.shellId),
    startedAt: args.startedAt,
    pid: handle.pid,
    outputPath: files.output,
    cursorPath: files.cursor,
    inputSupported: true,
    totalBytes: () => sizeOf(files.output),
    readOutput: async ({ start, limit }) => readRange({ path: files.output, start, limit }),
    writeInput: async ({ text, end }) => {
      const written = text === '' ? ({ ok: true } as const) : await handle.writeInput(text)
      if (!written.ok || end !== true) return reply(written)
      return reply(await handle.closeInput())
    },
    kill: (by) => {
      killedBy ??= by
      handle.terminate()
    },
    watch: ({ onOutput, onExit }) => {
      generation += 1
      const mine = generation
      const reader = handle.stdout.getReader()
      void (async () => {
        for (;;) {
          const chunk = await reader.read().catch(() => ({ done: true as const, value: undefined }))
          if (chunk.done || mine !== generation) return
          onOutput(handle.spoolOffset())
        }
      })()
      void handle.settled.then((outcome) => {
        if (mine !== generation || outcome.kind === 'detached') return
        const endedAt = args.startedAt
        if (outcome.kind === 'lost') {
          onExit({
            status: EShellStatus.Killed,
            killedBy: EKilledBy.LostContact,
            endedAt,
            totalBytes: sizeOf(files.output),
          })
          return
        }
        onExit(exitOf({ exit: outcome.exit, killedBy, endedAt: new Date(outcome.exit.endedAt).toISOString() }))
      })
    },
    detach: async () => {
      generation += 1
      await handle.detach()
    },
  }
}
