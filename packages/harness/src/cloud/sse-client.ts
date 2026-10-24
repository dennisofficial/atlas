import { runAttempt } from './sse-attempt'
import type { SseHandlers } from './sse-types'

export { SseRefused, type SseHandlers, type SsePrFrame } from './sse-types'

const RETRY_FLOOR_MS = 1_000
const RETRY_CAP_MS = 30_000
const SILENCE_TIMEOUT_MS = 75_000

const sleepUnlessAborted = (args: { ms: number; signal: AbortSignal }): Promise<void> =>
  new Promise<void>((resolve) => {
    const settle = (): void => {
      clearTimeout(timer)
      args.signal.removeEventListener('abort', settle)
      resolve()
    }
    const timer = setTimeout(settle, args.ms)
    args.signal.addEventListener('abort', settle, { once: true })
  })

/**
 * One pull request stream's full life, owning every reconnect: the tRPC link and eventsource are
 * unsubscribed on any drop signal and never retry on their own. Drops back off with a cap; a
 * connection silent for `silenceTimeoutMs` (75s default) is replaced the same way. Resolves on
 * abort; rejects with `SseRefused` on 401/403. `onOpen` is awaited before frames flow but is cut
 * off by the same silence timeout, so a hung catch-up reconnects while the stale work settles.
 */
export async function runSseStream(args: {
  baseUrl: string
  token: string
  clientVersion: string
  signal: AbortSignal
  handlers: SseHandlers
  silenceTimeoutMs?: number | undefined
  randomFn?: (() => number) | undefined
}): Promise<void> {
  const randomFn = args.randomFn ?? Math.random
  let consecutiveDrops = 0

  while (!args.signal.aborted) {
    const end = await runAttempt({
      baseUrl: args.baseUrl,
      token: args.token,
      clientVersion: args.clientVersion,
      signal: args.signal,
      handlers: args.handlers,
      silenceTimeoutMs: args.silenceTimeoutMs ?? SILENCE_TIMEOUT_MS,
      onCaughtUp: () => {
        consecutiveDrops = 0
      },
    })
    if (end.kind === 'aborted' || args.signal.aborted) return

    consecutiveDrops += 1
    args.handlers.onDrop?.()
    await sleepUnlessAborted({
      ms: Math.min(RETRY_CAP_MS, RETRY_FLOOR_MS * 2 ** (consecutiveDrops - 1)) * randomFn(),
      signal: args.signal,
    })
  }
}
