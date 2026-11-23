import { type OomMemory } from '@dltech/atlas-core'
import { EExecOutcome } from '@dltech/atlas-protocol'
import { type DaemonGroupFactory, defineOp } from '@dltech/atlas-protocol/engine'

import { ManagedProcess } from '../../process/managed'
import type { DaemonOpsDeps } from '../deps'
import { commandNameOf, oomRecorderOf } from '../oom/recorder'
import { type AdoptRequest, type ExecHold, shellsRegistryOf } from '../shells/registry'

const outcomeOf = (args: { oom: boolean; cancelled: boolean; timedOut: boolean }): EExecOutcome => {
  if (args.oom) return EExecOutcome.OomKilled
  if (args.cancelled) return EExecOutcome.Cancelled
  if (args.timedOut) return EExecOutcome.TimedOut
  return EExecOutcome.Exited
}

export const execGroup =
  (deps: DaemonOpsDeps): DaemonGroupFactory =>
  () => {
    const registry = shellsRegistryOf(deps)

    return {
      name: 'exec',
      ops: [
        defineOp({
          op: 'exec',
          run: async ({ op, ctx }) => {
            let outputBytes = 0
            const forward = (bytes: Uint8Array): void => {
              outputBytes += bytes.length
              ctx.output(bytes)
            }
            let sink: (bytes: Uint8Array) => void = forward
            const child = ManagedProcess.spawn({
              cmd: op.argv,
              cwd: op.cwd,
              env: { ...deps.env, ...op.env },
              onStdout: (bytes) => sink(bytes),
              onStderr: (bytes) => sink(bytes),
            })
            let timedOut = false
            const timer =
              op.timeoutMs === undefined
                ? undefined
                : setTimeout(() => {
                    timedOut = true
                    child.kill()
                  }, op.timeoutMs)
            const handleAbort = (): void => child.kill()
            ctx.signal.addEventListener('abort', handleAbort, { once: true })
            if (ctx.signal.aborted) child.kill()
            const hold: ExecHold = {
              command: commandNameOf(op.argv),
              process: child,
              setSink: (next) => {
                sink = next
              },
              detach: () => {
                if (timer !== undefined) clearTimeout(timer)
                ctx.signal.removeEventListener('abort', handleAbort)
              },
            }
            let decided = false
            let announce: ((request: AdoptRequest) => void) | null = null
            const adoption = new Promise<AdoptRequest>((resolve) => {
              announce = resolve
            })
            registry.offers.set(ctx.key, (request) => {
              if (decided) {
                request.answer({ adopted: false })
                return
              }
              decided = true
              announce?.(request)
            })
            try {
              const exit = child.exit()
              const first = await Promise.race([
                exit.then((value) => ({ kind: 'exit' as const, value })),
                adoption.then((request) => ({ kind: 'claim' as const, request })),
              ])
              if (first.kind === 'claim') {
                const info = await registry.handOver({
                  shellId: first.request.shellId,
                  hold,
                })
                if (info === null) {
                  first.request.answer({ adopted: false })
                } else {
                  first.request.answer({ adopted: true, info })
                  return {
                    exitCode: null,
                    signal: null,
                    outcome: EExecOutcome.Backgrounded,
                    outputBytes,
                    shellId: info.shellId,
                  }
                }
              }
              decided = true
              const ended = first.kind === 'exit' ? first.value : await exit
              let memory: OomMemory | null = null
              if (ended.oom) {
                ctx.publish({ type: 'exec.oom-kill', key: ctx.key })
                memory = oomRecorderOf(deps).command({
                  pid: child.pid,
                  command: commandNameOf(op.argv),
                  publish: ctx.publish,
                })
              }
              return {
                exitCode: ended.exitCode,
                signal: ended.signal,
                outcome: outcomeOf({
                  oom: ended.oom,
                  cancelled: ctx.signal.aborted,
                  timedOut,
                }),
                outputBytes,
                ...(memory === null ? {} : { memory }),
              }
            } finally {
              registry.offers.delete(ctx.key)
              if (timer !== undefined) clearTimeout(timer)
              ctx.signal.removeEventListener('abort', handleAbort)
            }
          },
        }),
        defineOp({
          op: 'exec.background',
          run: ({ op }) => registry.adopt({ execKey: op.execKey, shellId: op.shellId }),
        }),
      ],
    }
  }
