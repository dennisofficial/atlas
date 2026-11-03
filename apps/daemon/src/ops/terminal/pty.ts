import { CallFailureError, ECallFailure } from '@dltech/atlas-protocol'
import { killWorkloadBox, workloadCommand } from '@dltech/atlas-sandbox'

import type { DaemonOpsDeps } from '../deps'

export const MAX_OPEN_TERMINALS = 8
const KILL_GRACE_MS = 2000

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const signalNameOf = (signal: string | number | null): string | null =>
  typeof signal === 'string' ? signal : null

const shellOf = (env: Record<string, string | undefined>): string => {
  const named = env.SHELL
  return named === undefined || named === '' ? '/bin/bash' : named
}

const terminalEnv = (
  source: Record<string, string | undefined>,
): Record<string, string | undefined> => {
  const env: Record<string, string | undefined> = {
    ...source,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
  }
  delete env.V2_DAEMON_SECRET
  return env
}

export const missingTerminal = (terminalId: string): CallFailureError =>
  new CallFailureError({
    code: ECallFailure.NotFound,
    message: `no terminal ${terminalId}`,
  })

export type SpawnedTerminal = {
  pid: number
  write(data: string): void
  resize(args: { cols: number; rows: number }): void
  exited: Promise<number>
  exitState(): { exitCode: number | null; signal: string | null }
  killTree(): void
}

export const spawnPty = (args: {
  deps: DaemonOpsDeps
  cols: number
  rows: number
  cwd?: string | undefined
  onChunk(bytes: Uint8Array): void
}): SpawnedTerminal => {
  const env = terminalEnv(args.deps.env)
  const command = workloadCommand({ cmd: [shellOf(env)], cwd: args.cwd, env })
  let child: ReturnType<typeof Bun.spawn>
  try {
    child = Bun.spawn(command, {
      ...(args.cwd === undefined ? {} : { cwd: args.cwd }),
      env,
      terminal: {
        cols: args.cols,
        rows: args.rows,
        data: (_terminal, chunk) => args.onChunk(new Uint8Array(chunk)),
      },
    })
  } catch (error) {
    throw new CallFailureError({ code: ECallFailure.SpawnFailed, message: messageOf(error) })
  }
  const terminal = child.terminal
  if (terminal === undefined) {
    child.kill()
    throw new CallFailureError({
      code: ECallFailure.Internal,
      message: 'this runtime could not attach a pseudo-terminal',
    })
  }
  // Bun's terminal spawn calls setsid: the PTY child leads its own process group and session
  // (verified: ps shows pid == pgid == sid), so a negative pid signals the whole tree.
  const killGroup = (signal: NodeJS.Signals): void => {
    try {
      process.kill(-child.pid, signal)
    } catch {
      try {
        child.kill(signal)
      } catch {
        return
      }
    }
  }
  let killing = false
  return {
    pid: child.pid,
    write: (data) => {
      if (terminal.closed) return
      terminal.write(data)
    },
    resize: ({ cols, rows }) => {
      if (terminal.closed) return
      terminal.resize(cols, rows)
    },
    exited: child.exited,
    exitState: () => ({ exitCode: child.exitCode, signal: signalNameOf(child.signalCode) }),
    killTree: () => {
      if (killing) return
      killing = true
      if (!terminal.closed) terminal.close()
      killGroup('SIGHUP')
      setTimeout(() => {
        if (child.exitCode !== null || child.signalCode !== null) return
        killGroup('SIGKILL')
      }, KILL_GRACE_MS).unref()
    },
  }
}

export const reapPtyBox = (args: { deps: DaemonOpsDeps; pid: number }): void => {
  killWorkloadBox({ pid: args.pid, env: terminalEnv(args.deps.env) })
}
