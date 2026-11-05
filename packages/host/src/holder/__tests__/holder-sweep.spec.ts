import { describe, expect, it } from 'bun:test'

import { flushUntil, makeRig, seedSession, SESSION } from './holder-rig'

const SWEEP_MS = 20_000

const answered = (rig: Awaited<ReturnType<typeof makeRig>>) => async (): Promise<boolean> =>
  (await rig.events()).some((event) => event.type === 'assistant-said')

describe('SessionHolder sweep', () => {
  it('answers a message whose wake was lost within one sweep', async () => {
    const rig = await makeRig({ sweepMs: SWEEP_MS })
    await seedSession(rig)
    await rig.holder.start()
    await rig.post('hello')
    await rig.flush()
    expect(await answered(rig)()).toBe(false)
    rig.clock.advance(25_000)
    const saw = await flushUntil({ check: answered(rig) })
    expect(saw).toBe(true)
  })

  it('serves a session refused for capacity once a slot frees, with no new wake', async () => {
    const rig = await makeRig({ maxSessions: 1, idleMinutes: 0.2, sweepMs: SWEEP_MS })
    await seedSession(rig)
    const second = 'session-second'
    await rig.plane.createSession({
      sessionId: second,
      userId: 'user-1',
      projectId: 'project-1',
      mainThreadId: 'thread-second',
    })
    await rig.holder.start()
    await rig.post('first')
    await rig.plane.post({
      sessionId: second,
      kind: 'message',
      payload: JSON.stringify({ text: 'second' }),
    })
    await rig.bus.wake(SESSION)
    await rig.bus.wake(second)
    await rig.flush()
    expect(rig.holder.heldIds()).toEqual([SESSION])
    const secondAnswered = async (): Promise<boolean> =>
      (
        await rig.plane.readEvents({
          threadId: 'thread-second' as never,
          afterSeq: 0,
          limit: 100,
          visible: false,
        })
      ).events.some((event) => event.type === 'assistant-said')
    const done = await flushUntil({
      check: secondAnswered,
      attempts: 400,
      clock: rig.clock,
      advanceMs: 13_000,
    })
    expect(done).toBe(true)
  }, 20_000)

  it('revokes a lease this host holds without running and then serves the session', async () => {
    const rig = await makeRig({ sweepMs: SWEEP_MS })
    await seedSession(rig)
    await rig.holder.start()
    const claim = await rig.plane.claim({ sessionId: SESSION, hostId: rig.hostId() })
    expect(claim.ok).toBe(true)
    await rig.post('hello')
    await rig.flush()
    expect(rig.holder.heldIds()).toEqual([])
    rig.clock.advance(25_000)
    const saw = await flushUntil({ check: answered(rig), attempts: 100 })
    expect(saw).toBe(true)
    const lease = await rig.plane.currentLease({ sessionId: SESSION })
    expect(lease.lease.epoch).toBeGreaterThan(claim.ok ? claim.lease.epoch : 0)
  })

  it('stops sweeping after drain', async () => {
    const rig = await makeRig({ sweepMs: SWEEP_MS })
    await seedSession(rig)
    await rig.holder.start()
    await rig.holder.drain({ deadline: rig.clock.now() + 1_000 })
    await rig.post('hello')
    rig.clock.advance(60_000)
    await rig.flush()
    expect(await answered(rig)()).toBe(false)
  })
})
