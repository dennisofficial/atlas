import type { SsePullRequestClock } from '../sse-pull-request-clock'

type FakeTimer = { due: number; handler: () => void }

export const createFakeTimerClock = (randomFn: () => number = () => 0) => {
  let now = 0
  let nextId = 0
  const timers = new Map<number, FakeTimer>()

  const setTimeoutFn = ((handler: unknown, ms?: number) => {
    nextId += 1
    if (typeof handler === 'function') timers.set(nextId, { due: now + (ms ?? 0), handler: handler as () => void })
    return { id: nextId, unref: () => undefined } as unknown as ReturnType<typeof setTimeout>
  }) as typeof setTimeout

  const clearTimeoutFn = ((timer: unknown) => {
    const id = (timer as { id?: number } | undefined)?.id
    if (id !== undefined) timers.delete(id)
  }) as typeof clearTimeout

  const nextDue = (target: number): [number, FakeTimer] | null => {
    let best: [number, FakeTimer] | null = null
    for (const entry of timers) {
      if (entry[1].due > target) continue
      if (best === null || entry[1].due < best[1].due) best = entry
    }
    return best
  }

  const advance = async (ms: number): Promise<void> => {
    const target = now + ms
    for (let due = nextDue(target); due !== null; due = nextDue(target)) {
      timers.delete(due[0])
      now = Math.max(now, due[1].due)
      due[1].handler()
      await Bun.sleep(0)
    }
    now = target
  }

  const clock: SsePullRequestClock = { now: () => now, setTimeoutFn, clearTimeoutFn, randomFn }
  return { clock, advance, pending: () => timers.size, dueTimes: () => [...timers.values()].map((timer) => timer.due) }
}
