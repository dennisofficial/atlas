import { describe, expect, it } from 'bun:test'
import { LogPort, type LogEntry } from '@dltech/atlas-observability'

import { flushUntil, makeRig, seedSession, SESSION, type HolderRig } from './holder-rig'

class CollectingLog extends LogPort {
  readonly entries: LogEntry[] = []
  record(entry: LogEntry): void {
    this.entries.push(entry)
  }
}

const SWEEP_MS = 5_000

const answers = async (rig: HolderRig): Promise<number> =>
  (await rig.events()).filter((event) => event.type === 'assistant-said').length

const typesOf = async (rig: HolderRig): Promise<string[]> =>
  (await rig.events()).map((event) => event.type)

const leaseOf = async (rig: HolderRig) =>
  (await rig.plane.currentLease({ sessionId: SESSION })).lease

const idleRig = async (args: { log?: LogPort } = {}): Promise<HolderRig> => {
  const rig = await makeRig({ idleMinutes: 0.2, sweepMs: SWEEP_MS, ...args })
  await seedSession(rig)
  await rig.holder.start()
  await rig.post('hello')
  await rig.wake()
  const saw = await flushUntil({
    check: async () => (await answers(rig)) === 1,
    clock: rig.clock,
    advanceMs: 2_000,
    attempts: 200,
  })
  expect(saw).toBe(true)
  return rig
}

const advanceUntil = (rig: HolderRig, check: () => Promise<boolean> | boolean) =>
  flushUntil({ check, clock: rig.clock, advanceMs: 2_000, attempts: 400 })

describe('SessionHolder settle', () => {
  it('F29: a failed settle leaves the lease held and the claim loop settles it within two ticks', async () => {
    const rig = await idleRig()
    const original = rig.plane.revoke.bind(rig.plane)
    let failed = 0
    rig.plane.revoke = (async (params: Parameters<typeof rig.plane.revoke>[0]) => {
      if (failed < 2) {
        failed += 1
        throw new Error('control plane down')
      }
      return original(params)
    }) as typeof rig.plane.revoke

    rig.clock.advance(13_000)
    expect(
      await flushUntil({
        check: () => failed === 1,
        clock: rig.clock,
        advanceMs: 100,
        attempts: 400,
      }),
    ).toBe(true)
    expect(rig.holder.heldIds()).toEqual([])
    expect((await leaseOf(rig)).holderHostId).toBe(rig.hostId())

    const startedAt = rig.clock.now()
    const released = await flushUntil({
      check: async () => (await leaseOf(rig)).holderHostId === null,
      clock: rig.clock,
      advanceMs: SWEEP_MS,
      attempts: 40,
    })
    expect(released).toBe(true)
    expect(failed).toBe(2)
    expect(rig.clock.now() - startedAt).toBeLessThanOrEqual(2 * SWEEP_MS)

    await rig.post('later')
    await rig.wake()
    expect(await advanceUntil(rig, async () => (await answers(rig)) === 2)).toBe(true)
  }, 20_000)

  it('Fenced writes nothing: a holder whose epoch moved never calls revoke', async () => {
    const rig = await idleRig()
    const thief = rig.store.nextHostId()
    rig.store.markHostPresent(thief)
    await rig.plane.grant({ sessionId: SESSION, hostId: thief })
    const successor = await leaseOf(rig)
    const original = rig.plane.revoke.bind(rig.plane)
    let revokes = 0
    rig.plane.revoke = (async (params: Parameters<typeof rig.plane.revoke>[0]) => {
      revokes += 1
      return original(params)
    }) as typeof rig.plane.revoke

    rig.clock.advance(13_000)
    expect(await advanceUntil(rig, () => rig.holder.heldIds().length === 0)).toBe(true)
    await rig.flush()
    expect(revokes).toBe(0)
    expect(await leaseOf(rig)).toEqual(successor)
  }, 20_000)

  it('quarantines a crash-looping session: one failure event, no runtime, fresh tries after', async () => {
    const rig = await makeRig({ sweepMs: SWEEP_MS })
    await seedSession(rig)
    const seeded = await leaseOf(rig)
    const wrote = await rig.store.transact((tx) =>
      tx.writeLease({ lease: { ...seeded, attempts: 5 }, expectedEpoch: seeded.epoch }),
    )
    expect(wrote).toBe(true)
    await rig.post('hello')
    await rig.holder.start()
    await rig.wake()

    const recorded = await advanceUntil(rig, async () =>
      (await typesOf(rig)).includes('session-start-failed'),
    )
    expect(recorded).toBe(true)
    await rig.flush()
    expect(rig.runtimes).toHaveLength(0)
    expect((await typesOf(rig)).filter((type) => type === 'session-start-failed')).toHaveLength(1)
    expect(await leaseOf(rig)).toMatchObject({
      holderHostId: null,
      wantsHolder: false,
      attempts: 0,
      retryAfter: null,
    })

    await rig.post('again')
    await rig.wake()
    expect(await advanceUntil(rig, async () => (await answers(rig)) === 1)).toBe(true)
    expect((await typesOf(rig)).filter((type) => type === 'session-start-failed')).toHaveLength(1)
  }, 20_000)

  it('feeds the own-lease audit through settle, logs an error and serves the session', async () => {
    const log = new CollectingLog()
    const rig = await makeRig({ sweepMs: SWEEP_MS, log })
    await rig.holder.start()
    await rig.flush()
    await seedSession(rig)
    const claim = await rig.plane.claim({ sessionId: SESSION, hostId: rig.hostId() })
    expect(claim.ok).toBe(true)
    await rig.post('hello')
    await rig.flush()
    expect(rig.holder.heldIds()).toEqual([])

    rig.clock.advance(25_000)
    expect(await advanceUntil(rig, async () => (await answers(rig)) === 1)).toBe(true)
    const audited = log.entries.filter(
      (entry) => entry.severity === 'error' && entry.message.includes('without running it'),
    )
    expect(audited.length).toBeGreaterThan(0)
  }, 20_000)

  it('rings its own doorbell instead of waking: input posted during the release is answered', async () => {
    const rig = await idleRig()
    let wakesAfterPost = -1
    const original = rig.plane.revoke.bind(rig.plane)
    rig.plane.revoke = (async (params: Parameters<typeof rig.plane.revoke>[0]) => {
      if (wakesAfterPost < 0) {
        await rig.post('late arrival')
        wakesAfterPost = rig.wakeCount(SESSION)
      }
      return original(params)
    }) as typeof rig.plane.revoke

    rig.clock.advance(13_000)
    const answered = await advanceUntil(
      rig,
      async () => (await rig.events()).filter((event) => event.type === 'user-said').length === 2,
    )
    expect(answered).toBe(true)
    expect(wakesAfterPost).toBeGreaterThan(0)
    expect(rig.wakeCount(SESSION)).toBe(wakesAfterPost)
  }, 20_000)
})
