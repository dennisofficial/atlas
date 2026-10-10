import { CloudError } from './cloud-transport'
import type { SseSubscriptionBook } from './sse-pull-request-book'

const TERMINAL_STATUSES: readonly number[] = [401, 403, 404]
const CONSECUTIVE_FAILURES_BEFORE_CATCH_UP = 2
const TICK_JITTER_FRACTION = 0.25

export type HeartbeatClock = {
  setTimeoutFn: typeof setTimeout
  clearTimeoutFn: typeof clearTimeout
  randomFn: () => number
}

export type HeartbeatLoop = {
  start: () => void
  stop: () => void
}

export function createHeartbeatLoop(args: {
  intervalMs: number
  clock: HeartbeatClock
  book: Pick<SseSubscriptionBook, 'entries' | 'holding'>
  beat: (beatArgs: { id: string }) => Promise<void>
  onEmpty: () => void
  onNeedsCatchUp: () => void
}): HeartbeatLoop {
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const failures = new Map<string, number>()
  let epoch = 0
  let running = false

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const timer = args.clock.setTimeoutFn(() => {
        timers.delete(timer)
        resolve()
      }, ms)
      timer.unref?.()
      timers.add(timer)
    })

  const jitter = (windowMs: number): number => Math.floor(args.clock.randomFn() * windowMs)

  const noteFailure = ({ key, failure }: { key: string; failure: unknown }): void => {
    const terminal = failure instanceof CloudError && TERMINAL_STATUSES.includes(failure.status)
    const consecutive = (failures.get(key) ?? 0) + 1
    if (!terminal && consecutive < CONSECUTIVE_FAILURES_BEFORE_CATCH_UP) {
      failures.set(key, consecutive)
      return
    }
    failures.delete(key)
    args.onNeedsCatchUp()
  }

  const beatEntry = async ({ key, tickEpoch }: { key: string; tickEpoch: number }): Promise<void> => {
    await sleep(jitter(args.intervalMs))
    if (tickEpoch !== epoch) return
    const entry = args.book.holding({ key })
    if (entry === null) return
    try {
      await args.beat({ id: entry.handle.id })
      failures.delete(key)
    } catch (failure) {
      if (tickEpoch !== epoch) return
      noteFailure({ key, failure })
    }
  }

  const tick = async (tickEpoch: number): Promise<void> => {
    const entries = args.book.entries()
    if (entries.length === 0) {
      stop()
      args.onEmpty()
      return
    }
    await Promise.all(entries.map((entry) => beatEntry({ key: entry.key, tickEpoch })))
    if (tickEpoch !== epoch) return
    scheduleTick()
  }

  const scheduleTick = (): void => {
    const tickEpoch = epoch
    void sleep(args.intervalMs + jitter(args.intervalMs * TICK_JITTER_FRACTION)).then(() => {
      if (tickEpoch !== epoch) return
      return tick(tickEpoch)
    })
  }

  const stop = (): void => {
    if (!running) return
    running = false
    epoch += 1
    for (const timer of timers) args.clock.clearTimeoutFn(timer)
    timers.clear()
    failures.clear()
  }

  const start = (): void => {
    if (running) return
    running = true
    scheduleTick()
  }

  return { start, stop }
}
