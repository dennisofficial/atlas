import { describe, expect, it } from 'bun:test'

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

  it('F34: a full host takes the waiting session when a slot frees, with no new post or wake', async () => {
    const rig = await makeRig({ maxSessions: 1, idleMinutes: 0.2 })
    await seedSession(rig)
    await rig.plane.createSession({
      sessionId: SECOND,
      userId: 'user-1',
      projectId: 'project-1',
      mainThreadId: SECOND_THREAD,
    })
    await rig.holder.start()
    await rig.post('first')
    await rig.plane.post({
      sessionId: SECOND,
      kind: 'message',
      payload: JSON.stringify({ text: 'second' }),
    })
    await rig.bus.wake(SESSION)
    await rig.bus.wake(SECOND)
    await rig.flush()
    expect(rig.holder.heldIds()).toEqual([SESSION])

    const secondAnswered = async (): Promise<boolean> =>
      (
        await rig.plane.readEvents({
          threadId: SECOND_THREAD as never,
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

  it('asks claimNext for exactly the free slots', async () => {
    const rig = await makeRig({ maxSessions: 3 })
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
    expect(limits[0]).toBe(3)
    expect(limits.every((limit) => limit > 0 && limit <= 3)).toBe(true)
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
})
