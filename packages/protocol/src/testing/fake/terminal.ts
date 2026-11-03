import { defineOp, type DaemonGroupFactory, type GroupContext } from '../../engine'
import { CallFailureError, ECallFailure, type TerminalExit } from '../../ops'

const MAX_OPEN_TERMINALS = 8
const SCROLLBACK_BYTES = 1024 * 1024
const ECHO_PREFIX = new TextEncoder().encode('\r\n$ ')

type FakeTerminal = {
  scrollback: Uint8Array
  total: number
  exited: TerminalExit | null
  exitWaiters: Set<(exit: TerminalExit) => void>
}

const missingTerminal = (terminalId: string): CallFailureError =>
  new CallFailureError({
    code: ECallFailure.NotFound,
    message: `no terminal ${terminalId}`,
  })

export const fakeTerminalGroup = (): DaemonGroupFactory => {
  return (ctx: GroupContext) => {
    const terminals = new Map<string, FakeTerminal>()
    const encoder = new TextEncoder()

    const emit = (args: { terminalId: string; terminal: FakeTerminal; bytes: Uint8Array }) => {
      const offset = args.terminal.total
      args.terminal.total += args.bytes.length
      args.terminal.scrollback = Buffer.concat([args.terminal.scrollback, args.bytes])
      const extra = args.terminal.scrollback.length - SCROLLBACK_BYTES
      if (extra > 0) args.terminal.scrollback = args.terminal.scrollback.subarray(extra)
      ctx.publish({
        type: 'terminal.output',
        terminalId: args.terminalId,
        offset,
        data: Buffer.from(args.bytes).toString('base64'),
      })
    }

    const finish = (args: { terminalId: string; exit: TerminalExit }) => {
      const terminal = terminals.get(args.terminalId)
      if (terminal === undefined) return
      terminal.exited = args.exit
      for (const waiter of [...terminal.exitWaiters]) waiter(args.exit)
      terminal.exitWaiters.clear()
      ctx.publish({ type: 'terminal.exit', terminalId: args.terminalId, ...args.exit })
    }

    return {
      name: 'terminal',
      ops: [
        defineOp({
          op: 'terminal.open',
          run: async ({ op }) => {
            if (terminals.size >= MAX_OPEN_TERMINALS) {
              throw new CallFailureError({
                code: ECallFailure.InvalidInput,
                message: `the daemon already has ${MAX_OPEN_TERMINALS} terminals open`,
              })
            }
            if (terminals.has(op.terminalId)) {
              throw new CallFailureError({
                code: ECallFailure.AlreadyExists,
                message: `a terminal ${op.terminalId} is already open`,
              })
            }
            terminals.set(op.terminalId, {
              scrollback: new Uint8Array(0),
              total: 0,
              exited: null,
              exitWaiters: new Set(),
            })
            return { terminalId: op.terminalId, pid: 1000 + terminals.size }
          },
        }),
        defineOp({
          op: 'terminal.write',
          run: async ({ op }) => {
            const terminal = terminals.get(op.terminalId)
            if (terminal === undefined || terminal.exited !== null)
              throw missingTerminal(op.terminalId)
            const bytes = encoder.encode(op.data)
            emit({ terminalId: op.terminalId, terminal, bytes })
            emit({ terminalId: op.terminalId, terminal, bytes: ECHO_PREFIX })
            const trimmed = op.data.trimEnd()
            if (trimmed === 'exit' || /^exit \d+$/.test(trimmed)) {
              const code = trimmed === 'exit' ? 0 : Number(trimmed.slice(5))
              finish({ terminalId: op.terminalId, exit: { exitCode: code, signal: null } })
            }
            return null
          },
        }),
        defineOp({
          op: 'terminal.resize',
          run: async ({ op }) => {
            const terminal = terminals.get(op.terminalId)
            if (terminal === undefined || terminal.exited !== null)
              throw missingTerminal(op.terminalId)
            return null
          },
        }),
        defineOp({
          op: 'terminal.close',
          run: async ({ op }) => {
            const terminal = terminals.get(op.terminalId)
            if (terminal === undefined) throw missingTerminal(op.terminalId)
            if (terminal.exited !== null) return terminal.exited
            finish({ terminalId: op.terminalId, exit: { exitCode: null, signal: 'SIGHUP' } })
            return { exitCode: null, signal: 'SIGHUP' }
          },
        }),
        defineOp({
          op: 'terminal.read',
          run: async ({ op }) => {
            const terminal = terminals.get(op.terminalId)
            if (terminal === undefined) throw missingTerminal(op.terminalId)
            const floor = terminal.total - terminal.scrollback.length
            const offset = Math.max(op.offset, floor)
            const bytes = terminal.scrollback.subarray(offset - floor)
            return {
              offset,
              data: Buffer.from(bytes).toString('base64'),
              totalBytes: terminal.total,
              exited: terminal.exited,
            }
          },
        }),
      ],
      stop: async () => {
        for (const terminalId of [...terminals.keys()]) {
          const terminal = terminals.get(terminalId)
          if (terminal !== undefined && terminal.exited === null) {
            finish({ terminalId, exit: { exitCode: null, signal: 'SIGHUP' } })
          }
        }
        terminals.clear()
      },
    }
  }
}
