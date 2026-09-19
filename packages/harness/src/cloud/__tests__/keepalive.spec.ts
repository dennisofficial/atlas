import { describe, expect, it } from 'bun:test'

import { intervalKeepaliveScheduler } from '../keepalive'

describe('the default interval keepalive scheduler', () => {
  it('runs the given task repeatedly on the interval', async () => {
    let calls = 0
    const stop = intervalKeepaliveScheduler({ intervalMs: 5, run: () => void (calls += 1) })

    await Bun.sleep(24)
    stop()

    expect(calls).toBeGreaterThanOrEqual(3)
  })

  it('stops running the task once the returned unsubscribe is called', async () => {
    let calls = 0
    const stop = intervalKeepaliveScheduler({ intervalMs: 5, run: () => void (calls += 1) })

    await Bun.sleep(12)
    stop()
    const seenBeforeWaiting = calls
    await Bun.sleep(20)

    expect(calls).toBe(seenBeforeWaiting)
  })
})
