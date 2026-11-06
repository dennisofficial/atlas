import { describe, expect, it } from 'bun:test'

import { ClaimLoop } from '../claim-loop'
import { FakeClock } from './rig-fakes'

const makeLoop = (args: { clock: FakeClock; nextRetryAt: () => string | null }): ClaimLoop =>
  new ClaimLoop({
    timers: args.clock,
    tickMs: 0,
    hostId: () => 1,
    draining: () => false,
    freeSlots: () => 4,
    claimNext: async () => ({ leases: [], nextRetryAt: args.nextRetryAt() }),
    hold: async () => undefined,
    onTick: async () => undefined,
    settlePending: async () => undefined,
    log: undefined,
  })

const settleLoop = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('ClaimLoop due timer', () => {
  it('keeps a single pending timer across passes that report the same retry time', async () => {
    const clock = new FakeClock()
    const at = new Date(5_000).toISOString()
    const loop = makeLoop({ clock, nextRetryAt: () => at })
    loop.start()
    await settleLoop()
    for (let i = 0; i < 5; i += 1) {
      loop.ring()
      await settleLoop()
    }
    expect(clock.pendingCount()).toBe(1)
    loop.stop()
    expect(clock.pendingCount()).toBe(0)
  })

  it('replaces the pending timer only for an earlier time and rings when it is due', async () => {
    const clock = new FakeClock()
    let next: string | null = new Date(9_000).toISOString()
    let calls = 0
    const loop = new ClaimLoop({
      timers: clock,
      tickMs: 0,
      hostId: () => 1,
      draining: () => false,
      freeSlots: () => 4,
      claimNext: async () => {
        calls += 1
        return { leases: [], nextRetryAt: next }
      },
      hold: async () => undefined,
      onTick: async () => undefined,
      settlePending: async () => undefined,
      log: undefined,
    })
    loop.start()
    await settleLoop()
    next = new Date(20_000).toISOString()
    loop.ring()
    await settleLoop()
    expect(clock.pendingCount()).toBe(1)
    next = new Date(3_000).toISOString()
    loop.ring()
    await settleLoop()
    expect(clock.pendingCount()).toBe(1)
    const before = calls
    next = null
    clock.advance(3_000)
    await settleLoop()
    expect(calls).toBe(before + 1)
    expect(clock.pendingCount()).toBe(0)
  })
})
