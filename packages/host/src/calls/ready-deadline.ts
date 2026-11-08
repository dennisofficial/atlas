import { ReadyTimeoutError } from './errors'
import type { ReadyReply } from './ready-gate'
import type { CallTimers } from './remote-calls'

export const READY_TIMEOUT_MS = 60_000

export const withReadyDeadline = (args: {
  promise: Promise<ReadyReply>
  timeoutMs: number
  timers: CallTimers
  signal?: AbortSignal | undefined
}): Promise<ReadyReply | undefined> =>
  new Promise((resolve, reject) => {
    const timer = args.timers.setTimeout(() => {
      finish()
      reject(new ReadyTimeoutError(args.timeoutMs))
    }, args.timeoutMs)
    function onAbort(): void {
      finish()
      resolve(undefined)
    }
    function finish(): void {
      args.timers.clearTimeout(timer)
      args.signal?.removeEventListener('abort', onAbort)
    }
    args.signal?.addEventListener('abort', onAbort, { once: true })
    args.promise.then(
      (reply) => {
        finish()
        resolve(reply)
      },
      (error: unknown) => {
        finish()
        reject(error)
      },
    )
    if (args.signal?.aborted) onAbort()
  })
