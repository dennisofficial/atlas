import { describe, expect, it } from 'bun:test'

import { retryDelayMs } from '@dltech/atlas-core'

import { CLAIM_BATCH } from '../claim-loop'
import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID, type HolderRig } from './holder-rig'

const SWEEP_MS = 20_000
const SECOND = 'session-second'
const SECOND_THREAD = 'thread-second'

const typesOf = async (rig: HolderRig): Promise<string[]> =>
  (await rig.events()).map((event) => event.type)

const answered = (rig: HolderRig) => async (): Promise<boolean> =>
  (await typesOf(rig)).includes('assistant-said')

const recorded = (rig: HolderRig) => async (): Promise<boolean> =>
  (await typesOf(rig)).includes('session-start-failed')

const spyClaimNext = (rig: HolderRig): { calls(): number; reset(): void } => {
  let calls = 0
  const original = rig.plane.claimNext.bind(rig.plane)
  rig.plane.claimNext = async (params) => {
    calls += 1
    return original(params)
  }
  return {
    calls: () => calls,
    reset: () => {
      calls = 0
    },
  }
}

const failingStarts = () => {
  const state = { attempts: 0, remaining: Number.POSITIVE_INFINITY }
  return {
    state,
    beforeRuntime: async () => {
      state.attempts += 1
      if (state.remaining <= 0) return
      state.remaining -= 1
      throw new Error('db blip')
    },
  }
}

describe('SessionHolder claim loop', () => {
  it('holds a message whose wake was never delivered within one tick', async () => {
    const rig = await makeRig({ sweepMs: SWEEP_MS })
    await rig.holder.start()
    await rig.flush()
    await seedSession(rig)
    await rig.post('hello')
    await rig.flush()
    expect(rig.holder.heldIds()).toEqual([])
    rig.clock.advance(25_000)
    expect(await flushUntil({ check: answered(rig) })).toBe(true)
  })

  it('coalesces fifty wakes in one tick into at most two claimNext calls', async () => {
    const rig = await makeRig({})
    await seedSession(rig)
    await rig.holder.start()
    await rig.flush()
    const spy = spyClaimNext(rig)
    spy.reset()
    for (let i = 0; i < 50; i += 1) void rig.bus.wake(`unknown-${i}`)
    await rig.flush()
    expect(spy.calls()).toBeGreaterThanOrEqual(1)
    expect(spy.calls()).toBeLessThanOrEqual(2)
  })

  it('asks claimNext for a fixed batch, whatever is already held', async () => {
    const rig = await makeRig({})
    await seedSession(rig)
    const limits: number[] = []
    const original = rig.plane.claimNext.bind(rig.plane)
    rig.plane.claimNext = async (params) => {
      limits.push(params.limit)
      return original(params)
    }
    await rig.holder.start()
    await rig.post('hello')
    await rig.bus.wake(SESSION)
    await rig.flush()
    expect(limits[0]).toBe(CLAIM_BATCH)
    expect(limits.every((limit) => limit === CLAIM_BATCH)).toBe(true)
  })

  it('keeps going after claimNext throws and claims on the next ring', async () => {
    const rig = await makeRig({})
    await seedSession(rig)
    await rig.post('hello')
    const original = rig.plane.claimNext.bind(rig.plane)
    let failures = 1
    rig.plane.claimNext = async (params) => {
      if (failures > 0) {
        failures -= 1
        throw new Error('connection terminated unexpectedly')
      }
      return original(params)
    }
    await rig.holder.start()
    await rig.flush()
    expect(rig.holder.heldIds()).toEqual([])
    await rig.bus.wake(SESSION)
    expect(await flushUntil({ check: answered(rig) })).toBe(true)
  })
})

describe('SessionHolder start backoff on the lease row', () => {
  it('holds a failed start back on every host until retryAfter, gives up once at five, then resets', async () => {
    const fault = failingStarts()
    const a = await makeRig({ beforeRuntime: fault.beforeRuntime })
    await seedSession(a)
    const b = await makeRig({
      plane: a.plane,
      store: a.store,
      bus: a.bus,
      clock: a.clock,
      daemon: a.daemon,
      beforeRuntime: fault.beforeRuntime,
    })
    await a.post('hello')
    await a.holder.start()
    await a.wake()
    expect(await flushUntil({ check: () => fault.state.attempts === 1 })).toBe(true)
    await a.flush()

    await b.holder.start()
    await b.flush()
    await a.bus.wake(SESSION)
    a.clock.advance(999)
    await a.flush()
    expect(fault.state.attempts).toBe(1)

    a.clock.advance(1)
    expect(await flushUntil({ check: () => fault.state.attempts === 2 })).toBe(true)

    const done = await flushUntil({
      check: recorded(a),
      attempts: 400,
      clock: a.clock,
      advanceMs: 31_000,
    })
    expect(done).toBe(true)
    expect(fault.state.attempts).toBe(5)
    const { lease } = await a.plane.currentLease({ sessionId: SESSION })
    expect(lease).toMatchObject({ holderHostId: null, wantsHolder: false, attempts: 0 })
    expect(lease.retryAfter).toBeNull()

    fault.state.remaining = 4
    await a.post('again')
    await a.wake()
    const answeredAgain = await flushUntil({
      check: answered(a),
      attempts: 400,
      clock: a.clock,
      advanceMs: 31_000,
    })
    expect(answeredAgain).toBe(true)
    expect((await typesOf(a)).filter((type) => type === 'session-start-failed')).toHaveLength(1)
    expect(THREAD_ID).toBeDefined()
  })

  it('a peer takes a crashed holder session as soon as its backoff ends, with no tick due', async () => {
    const rig = await makeRig({ sweepMs: 600_000 })
    await rig.holder.start()
    await rig.flush()
    await seedSession(rig)
    await rig.flush()
    const crashed = rig.store.nextHostId()
    rig.store.markHostPresent(crashed)
    rig.holder.discard()
    const { leases } = await rig.plane.claimNext({ hostId: crashed, limit: 1 })
    expect(leases).toMatchObject([{ sessionId: SESSION, attempts: 1 }])
    rig.store.markHostAbsent(crashed)

    const b = await makeRig({
      plane: rig.plane,
      store: rig.store,
      bus: rig.bus,
      clock: rig.clock,
      daemon: rig.daemon,
      sweepMs: 600_000,
      script: [{ text: 'b says hi' }],
    })
    await b.holder.start()
    await b.flush()
    b.holder.ring()
    await b.flush()
    expect(b.holder.heldIds()).toEqual([])

    rig.clock.advance(retryDelayMs(1) - 1)
    await b.flush()
    expect(b.holder.heldIds()).toEqual([])
    rig.clock.advance(1)
    expect(await flushUntil({ check: () => b.runtimes.length > 0 })).toBe(true)
  })
})
