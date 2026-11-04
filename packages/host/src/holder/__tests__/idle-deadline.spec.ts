import { describe, expect, it } from 'bun:test'

import { IdleDeadline } from '../idle-deadline'
import { Reconciler } from '../reconciler'
import { FakeClock } from './rig-fakes'

const IDLE_MINUTES = 1
const IDLE_MS = IDLE_MINUTES * 60_000

const tick = async (times = 10): Promise<void> => {
  for (let i = 0; i < times; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('IdleDeadline', () => {
  it('fires once for an overdue deadline and leaves no timer armed for the same deadline', () => {
    const clock = new FakeClock()
    clock.current = 10 * IDLE_MS
    let due = 0
    const idle = new IdleDeadline({
      timers: clock,
      idleMinutes: IDLE_MINUTES,
      onDue: () => (due += 1),
    })
    idle.arm({ lastActivityAt: 0 })
    clock.advance(1)
    expect(due).toBe(1)

    idle.arm({ lastActivityAt: 0 })
    expect(clock.pendingWithin(Number.MAX_SAFE_INTEGER)).toBe(false)
    clock.advance(IDLE_MS)
    expect(due).toBe(1)
  })

  it('arms again for a later activity time', () => {
    const clock = new FakeClock()
    clock.current = 10 * IDLE_MS
    let due = 0
    const idle = new IdleDeadline({
      timers: clock,
      idleMinutes: IDLE_MINUTES,
      onDue: () => (due += 1),
    })
    idle.arm({ lastActivityAt: 0 })
    clock.advance(1)
    idle.arm({ lastActivityAt: clock.now() })
    expect(clock.pendingWithin(IDLE_MS)).toBe(true)
    clock.advance(IDLE_MS)
    expect(due).toBe(2)
  })

  it('a step that keeps waiting on an overdue deadline costs one extra step and then no timer', async () => {
    const clock = new FakeClock()
    clock.current = 10 * IDLE_MS
    let steps = 0
    const holder: { reconciler?: Reconciler } = {}
    const idle = new IdleDeadline({
      timers: clock,
      idleMinutes: IDLE_MINUTES,
      onDue: () => holder.reconciler?.request(),
    })
    holder.reconciler = new Reconciler({
      timers: clock,
      step: async () => {
        steps += 1
        idle.arm({ lastActivityAt: 0 })
      },
    })
    holder.reconciler.request()
    await tick()
    clock.advance(1)
    await tick()
    expect(steps).toBe(2)
    expect(clock.pendingWithin(Number.MAX_SAFE_INTEGER)).toBe(false)
  })
})
