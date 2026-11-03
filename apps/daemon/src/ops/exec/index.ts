import { EExecOutcome } from '@dltech/atlas-protocol'
import { type DaemonGroupFactory, defineOp } from '@dltech/atlas-protocol/engine'

import { ManagedProcess } from '../../process/managed'
import type { DaemonOpsDeps } from '../deps'

const outcomeOf = (args: { oom: boolean; cancelled: boolean; timedOut: boolean }): EExecOutcome => {
  if (args.oom) return EExecOutcome.OomKilled
  if (args.cancelled) return EExecOutcome.Cancelled
  if (args.timedOut) return EExecOutcome.TimedOut
  return EExecOutcome.Exited
}

export const execGroup =
  (deps: DaemonOpsDeps): DaemonGroupFactory =>
  () => ({
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
          const child = ManagedProcess.spawn({
            cmd: op.argv,
            cwd: op.cwd,
            env: { ...deps.env, ...op.env },
            onStdout: forward,
            onStderr: forward,
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
          try {
            const exit = await child.exit()
            if (exit.oom) ctx.publish({ type: 'exec.oom-kill', key: ctx.key })
            return {
              exitCode: exit.exitCode,
              signal: exit.signal,
              outcome: outcomeOf({ oom: exit.oom, cancelled: ctx.signal.aborted, timedOut }),
              outputBytes,
            }
          } finally {
            if (timer !== undefined) clearTimeout(timer)
            ctx.signal.removeEventListener('abort', handleAbort)
          }
        },
      }),
    ],
  })
