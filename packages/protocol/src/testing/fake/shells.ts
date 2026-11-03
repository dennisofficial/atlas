import { type DaemonGroupFactory, type GroupContext, defineOp } from '../../engine'
import { CallFailureError, ECallFailure, EShellRunStatus, type ShellInfo } from '../../ops'

type FakeEnd = {
  status: EShellRunStatus
  exitCode: number | null
  signal: string | null
}

type FakeShell = {
  shellId: string
  command: string
  pid: number
  startedAt: string
  totalBytes: number
  limitBytes: number | null
  buffer: Buffer
  withInput: boolean
  inputEnded: boolean
  inputLines: string[]
  inputWaiters: Set<() => void>
  sleepWaiters: Set<() => void>
  variables: Map<string, string>
  timedOut: boolean
  end: FakeEnd | null
  endedAt: string
  timer: Timer | null
  endWaiters: Set<() => void>
}

const infoOf = (shell: FakeShell): ShellInfo => ({
  shellId: shell.shellId,
  command: shell.command,
  pid: shell.pid,
  startedAt: shell.startedAt,
  status: shell.end === null ? EShellRunStatus.Running : shell.end.status,
  exitCode: shell.end === null ? null : shell.end.exitCode,
  signal: shell.end === null ? null : shell.end.signal,
  ...(shell.end === null ? {} : { endedAt: shell.endedAt }),
  totalBytes: shell.totalBytes,
})

const notFound = (shellId: string): CallFailureError =>
  new CallFailureError({
    code: ECallFailure.NotFound,
    message: `no shell with id ${shellId}`,
  })

const unquote = (text: string): string => text.trim().replace(/^['"]|['"]$/g, '')

type ScriptStep =
  | { kind: 'output'; text: string }
  | { kind: 'sleep'; ms: number }
  | { kind: 'exit'; code: number }
  | { kind: 'read'; varName: string }
  | { kind: 'cat' }
  | { kind: 'spawn-bg' }
  | { kind: 'wait' }
  | { kind: 'noop' }

const expand = (text: string, shell: FakeShell): string =>
  text.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, name: string) => shell.variables.get(name) ?? '')

const parseStep = (text: string): ScriptStep => {
  const trimmed = text.trim().replace(/\s*1?>&2\s*$/, '')
  if (trimmed === '' || trimmed === 'true' || trimmed === ':') return { kind: 'noop' }
  if (/^.+ &\s*$/.test(trimmed)) return { kind: 'spawn-bg' }
  if (trimmed === 'wait') return { kind: 'wait' }
  if (trimmed === 'cat') return { kind: 'cat' }
  const read = /^read\s+([A-Za-z_][A-Za-z0-9_]*)$/.exec(trimmed)
  if (read?.[1] !== undefined) return { kind: 'read', varName: read[1] }
  const echo = /^echo\s+(.*)$/.exec(trimmed)
  if (echo?.[1] !== undefined) return { kind: 'output', text: `${unquote(echo[1])}\n` }
  const sleep = /^sleep\s+([\d.]+)$/.exec(trimmed)
  if (sleep?.[1] !== undefined) return { kind: 'sleep', ms: Math.ceil(Number(sleep[1]) * 1000) }
  const exit = /^exit\s+(\d+)$/.exec(trimmed)
  if (exit?.[1] !== undefined) return { kind: 'exit', code: Number(exit[1]) }
  return { kind: 'output', text: `fake shells cannot run: ${trimmed}\n` }
}

const stepsOf = (command: string): readonly ScriptStep[] => command.split(/;|&&|\n/).map(parseStep)

export const fakeShellsGroup = (): DaemonGroupFactory => {
  let nextPid = 4000

  return (groupCtx: GroupContext) => {
    const shells = new Map<string, FakeShell>()

    const lookup = (shellId: string): FakeShell => {
      const shell = shells.get(shellId)
      if (shell === undefined) throw notFound(shellId)
      return shell
    }

    const settle = (args: { shell: FakeShell; end: FakeEnd }): void => {
      const { shell } = args
      if (shell.end !== null) return
      shell.end = args.end
      shell.endedAt = new Date().toISOString()
      if (shell.timer !== null) {
        clearTimeout(shell.timer)
        shell.timer = null
      }
      for (const waiter of [...shell.endWaiters, ...shell.inputWaiters, ...shell.sleepWaiters]) {
        waiter()
      }
      shell.endWaiters.clear()
      shell.inputWaiters.clear()
      shell.sleepWaiters.clear()
      groupCtx.publish({ type: 'shells.ended', shellId: shell.shellId, info: infoOf(shell) })
    }

    const appendOutput = (args: { shell: FakeShell; text: string }): void => {
      const { shell } = args
      const bytes = Buffer.from(args.text, 'utf8')
      shell.totalBytes += bytes.length
      const room = shell.limitBytes === null ? bytes.length : shell.limitBytes - shell.buffer.length
      const accepted = bytes.subarray(0, Math.max(0, Math.min(room, bytes.length)))
      shell.buffer = Buffer.concat([shell.buffer, accepted])
      groupCtx.publish({
        type: 'shells.output',
        shellId: shell.shellId,
        totalBytes: shell.totalBytes,
      })
    }

    const nextLine = (shell: FakeShell): Promise<string | null> =>
      new Promise((resolve) => {
        const queued = shell.inputLines.shift()
        if (queued !== undefined) {
          resolve(queued)
          return
        }
        if (shell.inputEnded || shell.end !== null) {
          resolve(null)
          return
        }
        shell.inputWaiters.add(() => {
          const line = shell.inputLines.shift()
          resolve(line ?? null)
        })
      })

    const runShell = async (shell: FakeShell): Promise<void> => {
      await Promise.resolve()
      for (const step of stepsOf(shell.command)) {
        if (shell.end !== null) return
        if (step.kind === 'output') appendOutput({ shell, text: expand(step.text, shell) })
        if (step.kind === 'sleep') {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, step.ms)
            timer.unref()
            shell.sleepWaiters.add(() => {
              clearTimeout(timer)
              resolve()
            })
          })
        }
        if (step.kind === 'exit') {
          settle({
            shell,
            end: { status: EShellRunStatus.Exited, exitCode: step.code, signal: null },
          })
          return
        }
        if (step.kind === 'read') {
          const line = await nextLine(shell)
          if (shell.end !== null) return
          if (line === null) break
          shell.variables.set(step.varName, line)
        }
        if (step.kind === 'cat') {
          for (;;) {
            const line = await nextLine(shell)
            if (shell.end !== null) return
            if (line === null) break
            appendOutput({ shell, text: `${line}\n` })
          }
        }
      }
      if (shell.end === null) {
        settle({ shell, end: { status: EShellRunStatus.Exited, exitCode: 0, signal: null } })
      }
    }

    return {
      name: 'shells',
      ops: [
        defineOp({
          op: 'shells.launch',
          run: async ({ op }) => {
            if (shells.has(op.shellId)) {
              throw new CallFailureError({
                code: ECallFailure.AlreadyExists,
                message: `a shell with id ${op.shellId} already exists`,
              })
            }
            nextPid += 1
            const shell: FakeShell = {
              shellId: op.shellId,
              command: op.command,
              pid: nextPid,
              startedAt: new Date().toISOString(),
              totalBytes: 0,
              limitBytes: op.outputLimitBytes ?? null,
              buffer: Buffer.alloc(0),
              withInput: op.input === true,
              inputEnded: false,
              inputLines: [],
              inputWaiters: new Set(),
              sleepWaiters: new Set(),
              variables: new Map(),
              timedOut: false,
              end: null,
              endedAt: '',
              timer: null,
              endWaiters: new Set(),
            }
            shells.set(op.shellId, shell)
            if (op.timeoutMs !== undefined) {
              shell.timer = setTimeout(() => {
                shell.timedOut = true
                settle({
                  shell,
                  end: { status: EShellRunStatus.TimedOut, exitCode: null, signal: 'SIGKILL' },
                })
              }, op.timeoutMs)
              shell.timer.unref()
            }
            void runShell(shell)
            return infoOf(shell)
          },
        }),
        defineOp({
          op: 'shells.read',
          run: async ({ op }) => {
            const shell = lookup(op.shellId)
            const bytes = shell.buffer.subarray(op.offset, op.offset + op.limit)
            return {
              offset: op.offset,
              bytes: bytes.toString('base64'),
              totalBytes: shell.totalBytes,
              info: infoOf(shell),
            }
          },
        }),
        defineOp({
          op: 'shells.write',
          run: async ({ op }) => {
            const shell = lookup(op.shellId)
            if (!shell.withInput || shell.end !== null || shell.inputEnded) {
              throw new CallFailureError({
                code: ECallFailure.InvalidInput,
                message: `shell ${op.shellId} was not launched with input`,
              })
            }
            if (op.data.length > 0) {
              for (const line of op.data.split('\n')) {
                if (line.length > 0) shell.inputLines.push(line)
              }
              for (const waiter of [...shell.inputWaiters]) waiter()
              shell.inputWaiters.clear()
            }
            if (op.end === true) {
              shell.inputEnded = true
              for (const waiter of [...shell.inputWaiters]) waiter()
              shell.inputWaiters.clear()
            }
            return null
          },
        }),
        defineOp({
          op: 'shells.kill',
          run: async ({ op }) => {
            const shell = lookup(op.shellId)
            if (shell.end === null) {
              settle({
                shell,
                end: { status: EShellRunStatus.Killed, exitCode: null, signal: null },
              })
            }
            return infoOf(shell)
          },
        }),
        defineOp({
          op: 'shells.list',
          run: async () => [...shells.values()].map(infoOf),
        }),
      ],
      stop: async () => {
        for (const shell of shells.values()) {
          if (shell.end === null) {
            settle({ shell, end: { status: EShellRunStatus.Killed, exitCode: null, signal: null } })
          }
        }
      },
    }
  }
}
