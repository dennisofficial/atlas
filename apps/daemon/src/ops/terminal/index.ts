import { CallFailureError, ECallFailure, type TerminalExit } from '@dltech/atlas-protocol'
import { type DaemonGroupFactory, defineOp } from '@dltech/atlas-protocol/engine'

import type { DaemonOpsDeps } from '../deps'
import { MAX_OPEN_TERMINALS, reapPtyBox, spawnPty } from './pty'
import { TerminalRegistry, createScrollback } from './registry'

const EOF_GRACE_MS = 100

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export const terminalGroup =
  (deps: DaemonOpsDeps): DaemonGroupFactory =>
  (ctx) => {
    const registry = new TerminalRegistry()
    return {
      name: 'terminal',
      ops: [
        defineOp({
          op: 'terminal.open',
          run: async ({ op }) => {
            if (registry.size() >= MAX_OPEN_TERMINALS) {
              throw new CallFailureError({
                code: ECallFailure.InvalidInput,
                message: `the daemon already has ${MAX_OPEN_TERMINALS} terminals open`,
              })
            }
            const scrollback = createScrollback()
            const spawned = spawnPty({
              deps,
              cols: op.cols,
              rows: op.rows,
              ...(op.cwd === undefined ? {} : { cwd: op.cwd }),
              onChunk: (bytes) => {
                const offset = scrollback.push(bytes)
                ctx.publish({
                  type: 'terminal.output',
                  terminalId: op.terminalId,
                  offset,
                  data: Buffer.from(bytes).toString('base64'),
                })
              },
            })
            registry.add({ terminalId: op.terminalId, held: { spawned, scrollback } })
            void spawned.exited.then(async () => {
              await wait(EOF_GRACE_MS)
              const exit: TerminalExit = spawned.exitState()
              scrollback.finish(exit)
              registry.markExited(op.terminalId)
              reapPtyBox({ deps, pid: spawned.pid })
              ctx.publish({ type: 'terminal.exit', terminalId: op.terminalId, ...exit })
            })
            return { terminalId: op.terminalId, pid: spawned.pid }
          },
        }),
        defineOp({
          op: 'terminal.write',
          run: async ({ op }) => {
            registry.require(op.terminalId).spawned.write(op.data)
            return null
          },
        }),
        defineOp({
          op: 'terminal.resize',
          run: async ({ op }) => {
            registry.require(op.terminalId).spawned.resize({ cols: op.cols, rows: op.rows })
            return null
          },
        }),
        defineOp({
          op: 'terminal.close',
          run: async ({ op }) => {
            const held = registry.require(op.terminalId)
            held.spawned.killTree()
            return await held.scrollback.waitExit()
          },
        }),
        defineOp({
          op: 'terminal.read',
          run: async ({ op }) => {
            const scrollback = registry.scrollbackOf(op.terminalId)
            const { offset, bytes } = scrollback.slice({ from: op.offset })
            return {
              offset,
              data: Buffer.from(bytes).toString('base64'),
              totalBytes: scrollback.total,
              exited: scrollback.exited(),
            }
          },
        }),
      ],
      stop: () => registry.closeAll(),
    }
  }
