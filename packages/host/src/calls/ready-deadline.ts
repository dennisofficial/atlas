import { ReadyTimeoutError } from './errors'
import type { ReadyReply } from './ready-gate'
import type { CallTimers } from './remote-calls'

export const READY_TIMEOUT_MS = 60_000

type ReadyDeadlineArgs = {
  promise: Promise<ReadyReply>
  timeoutMs: number
  timers: CallTimers
  armedAfter?: Promise<unknown> | undefined
}

export function withReadyDeadline(args: ReadyDeadlineArgs): Promise<ReadyReply>
export function withReadyDeadline(
  args: ReadyDeadlineArgs & { signal: AbortSignal | undefined },
): Promise<ReadyReply | undefined>
export function withReadyDeadline(
  args: ReadyDeadlineArgs & { signal?: AbortSignal | undefined },
): Promise<ReadyReply | undefined> {
  return new Promise((resolve, reject) => {
    let timer: unknown
    function onAbort(): void {
      finish()
      resolve(undefined)
    }
    function finish(): void {
      if (timer !== undefined) args.timers.clearTimeout(timer)
      args.signal?.removeEventListener('abort', onAbort)
    }
    function arm(): void {
      if (timer !== undefined) return
      timer = args.timers.setTimeout(() => {
        finish()
        reject(new ReadyTimeoutError(args.timeoutMs))
      }, args.timeoutMs)
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
    if (args.armedAfter === undefined) arm()
    else {
      args.armedAfter.then(arm, (error: unknown) => {
        finish()
        reject(error)
      })
    }
    if (args.signal?.aborted) onAbort()
  })
}
