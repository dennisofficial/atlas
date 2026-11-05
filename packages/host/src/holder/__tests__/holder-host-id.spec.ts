import { describe, expect, it } from 'bun:test'

import { flushUntil, makeRig } from './holder-rig'

describe('SessionHolder host id', () => {
  it('exposes the live host id once started', async () => {
    const rig = await makeRig({})
    expect(rig.holder.hostId()).toBeUndefined()
    await rig.holder.start()
    expect(rig.holder.hostId()).toBe(rig.hostId())
  })

  it('calls onHostIdChanged when presence is lost and again once re-registered', async () => {
    const seen: (number | undefined)[] = []
    const rig = await makeRig({ onHostIdChanged: () => seen.push(rig.holder.hostId()) })
    await rig.holder.start()
    const first = rig.holder.hostId()
    expect(first).toBeDefined()

    rig.presence.lose()

    const reregistered = await flushUntil({
      check: () => Promise.resolve(seen.length >= 2),
      clock: rig.clock,
      attempts: 3000,
      advanceMs: 500,
    })
    expect(reregistered).toBe(true)
    expect(seen[0]).toBeUndefined()
    expect(seen[1]).toBeDefined()
    expect(seen[1]).not.toBe(first)
  }, 15_000)
})
