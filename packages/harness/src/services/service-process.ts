import { closeSync, mkdirSync, openSync, readSync, statSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'

import {
  EKilledBy,
  EServiceStatus,
  EStopAction,
  stopActionFor,
  type ClockPort,
  type ProcessHandle,
  type ProcessPort,
  type ThreadId,
} from '@dltech/atlas-core'

import { messageOf, withinReadGrace } from '../shells/shell-process'
import { atlasBinDirectory } from '../store/paths'

export const SERVICE_SETTLE_MS = 250

export type ServiceSnapshot = {
  serviceId: string
  command: string
  description: string
  status: EServiceStatus
  killedBy?: EKilledBy | undefined
  pid?: number | undefined
  exitCode?: number | undefined
  logPath: string
  startedAt: string
  endedAt?: string | undefined
}

export type Service = {
  readonly serviceId: string
  readonly logPath: string
  snapshot(): ServiceSnapshot
  stop(by: EKilledBy): EStopAction
  exited: Promise<void>
}

export type StartedService = { ok: true; service: Service } | { ok: false; reason: string }

type Pump = { done: Promise<void>; stop: () => void }

const hostPidOf = (handle: ProcessHandle): number | undefined =>
  'pid' in handle && typeof handle.pid === 'number' ? handle.pid : undefined

const pumpInto = (args: { stream: ReadableStream<Uint8Array>; fd: number }): Pump => {
  const reader = args.stream.getReader()
  const done = (async () => {
    for (;;) {
      const { done: finished, value } = await reader.read()
      if (finished) return
      if (value !== undefined && value.byteLength > 0) writeSync(args.fd, value)
    }
  })()
  done.catch(() => undefined)

  return { done, stop: () => void reader.cancel().catch(() => undefined) }
}

/**
 * A service's output is a file, not a buffer: a dev server prints unboundedly for hours, and the
 * model reads the log with the file tools it already has. The log stays a host-side file even when
 * the service runs inside the sandbox, so both ProcessHandle streams are pumped into it here; with
 * two readers instead of one shared fd, cross-stream interleave is chunk arrival order.
 */
export function startService(spec: {
  serviceId: string
  command: string
  description: string
  cwd: string
  logPath: string
  clock: ClockPort
  processes: ProcessPort
  threadId: ThreadId
  onExit: (service: Service) => void
}): StartedService {
  let fd: number
  try {
    mkdirSync(dirname(spec.logPath), { recursive: true })
    fd = openSync(spec.logPath, 'a')
  } catch (error) {
    return {
      ok: false,
      reason: `could not open the service log at ${spec.logPath}: ${messageOf(error)}`,
    }
  }

  let handle: ProcessHandle
  try {
    handle = spec.processes.spawn({
      cmd: ['bash', '-c', spec.command],
      cwd: spec.cwd,
      env: { ...process.env, PATH: `${atlasBinDirectory()}:${process.env.PATH ?? ''}` },
      threadId: spec.threadId,
    })
  } catch (error) {
    closeSync(fd)
    return { ok: false, reason: `could not start a service in ${spec.cwd}: ${messageOf(error)}` }
  }

  const pid = hostPidOf(handle)
  const stdout = pumpInto({ stream: handle.stdout, fd })
  const stderr = pumpInto({ stream: handle.stderr, fd })
  const drained = Promise.all([stdout.done, stderr.done])

  const startedAt = spec.clock.now()
  let status = EServiceStatus.Running
  let killedBy: EKilledBy | undefined
  let exitCode: number | undefined
  let endedAt: string | undefined
  let stopSignalled = false

  const stop = (by: EKilledBy): EStopAction => {
    const action = stopActionFor({ status, exitCode, stopSignalled })
    if (action === EStopAction.Gone) return action

    stopSignalled = true
    if (status === EServiceStatus.Running) {
      status = EServiceStatus.Killed
      killedBy = by
    }
    handle.terminate()
    return action
  }

  const settled = (async () => {
    try {
      exitCode = await handle.exited
    } catch {
      exitCode = undefined
    } finally {
      endedAt = spec.clock.now()
      if (status === EServiceStatus.Running) status = EServiceStatus.Exited
      await withinReadGrace(drained)
      stdout.stop()
      stderr.stop()
      closeSync(fd)
    }
  })()

  const self: Service = {
    serviceId: spec.serviceId,
    logPath: spec.logPath,

    snapshot: () => ({
      serviceId: spec.serviceId,
      command: spec.command,
      description: spec.description,
      status,
      killedBy,
      pid,
      exitCode,
      logPath: spec.logPath,
      startedAt,
      endedAt,
    }),

    stop,

    exited: settled.then(() => {
      try {
        spec.onExit(self)
      } catch {
        return
      }
    }),
  }

  return { ok: true, service: self }
}

/**
 * The last `characters` bytes of a service log, as text. A mid-file slice can land inside a
 * UTF-8 character or an ANSI escape sequence, leaving a fragment that would print as literal
 * garbage, so a sliced tail instead begins at the first line boundary after the cut.
 */
export function logTail(args: { path: string; characters: number }): string {
  try {
    const size = statSync(args.path).size
    const start = Math.max(0, size - args.characters)
    const fd = openSync(args.path, 'r')
    try {
      const buffer = Buffer.alloc(size - start)
      readSync(fd, buffer, 0, buffer.length, start)
      const text = buffer.toString('utf8')
      if (start === 0) return text

      const boundary = text.indexOf('\n')
      return boundary === -1 ? '' : text.slice(boundary + 1)
    } finally {
      closeSync(fd)
    }
  } catch {
    return ''
  }
}
