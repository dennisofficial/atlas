import { describe, expect, it } from 'bun:test'

import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID } from './holder-rig'

class PermanentError extends Error {}

type Rig = Awaited<ReturnType<typeof makeRig>>

const faultingRuntime = (args: { times: number; error: () => Error }) => {
  const state = { attempts: 0, remaining: args.times }
  return {
    state,
    beforeRuntime: async () => {
      state.attempts += 1
      if (state.remaining <= 0) return
      state.remaining -= 1
      throw args.error()
    },
  }
}

const typesOf = async (rig: Rig): Promise<string[]> => (await rig.events()).map((e) => e.type)

const answered = (rig: Rig) => async (): Promise<boolean> =>
  (await typesOf(rig)).includes('assistant-said')

const recorded = (rig: Rig) => async (): Promise<boolean> =>
  (await typesOf(rig)).includes('session-start-failed')

const startFailure = async (rig: Rig) => {
  const page = await rig.plane.readEvents({
    threadId: THREAD_ID,
    afterSeq: 0,
    limit: 100,
    visible: false,
  })
  return page.events.find((event) => event.type === 'session-start-failed')
}

const retryUntil = (rig: Rig, check: () => Promise<boolean>) =>
  flushUntil({ check, attempts: 400, clock: rig.clock, advanceMs: 31_000 })

describe('SessionHolder start failures', () => {
  it('records a permanent failure, releases without a holder, and stops churning epochs', async () => {
    const fault = faultingRuntime({
      times: 1,
      error: () => new PermanentError('no sandbox'),
    })
    const rig = await makeRig({
      beforeRuntime: fault.beforeRuntime,
      isPermanentStartError: (error) => error instanceof PermanentError,
    })
    await seedSession(rig)
    await rig.post('hello')
    await rig.holder.start()
    await rig.wake()
    expect(await flushUntil({ check: recorded(rig) })).toBe(true)
    await rig.flush()

    const failure = await startFailure(rig)
    expect(failure).toMatchObject({
      reason: 'no sandbox',
      inboxHead: 1,
      permanent: true,
    })
    const { lease } = await rig.plane.currentLease({ sessionId: SESSION })
    expect(lease.holderHostId).toBeNull()
    expect(lease.wantsHolder).toBe(false)
    expect(await rig.plane.sessionsNeedingHolder({ limit: 10 })).toEqual([])

    const epoch = lease.epoch
    rig.clock.advance(5 * 60_000)
    await rig.flush()
    expect((await rig.plane.currentLease({ sessionId: SESSION })).lease.epoch).toBe(epoch)
    expect(fault.state.attempts).toBe(1)
  })

  it('answers the next message after the factory is fixed', async () => {
    const fault = faultingRuntime({
      times: 1,
      error: () => new PermanentError('no sandbox'),
    })
    const rig = await makeRig({
      beforeRuntime: fault.beforeRuntime,
      isPermanentStartError: (error) => error instanceof PermanentError,
    })
    await seedSession(rig)
    await rig.post('hello')
    await rig.holder.start()
    await rig.wake()
    expect(await flushUntil({ check: recorded(rig) })).toBe(true)
    await rig.flush()

    await rig.post('again')
    await rig.wake()
    expect(await flushUntil({ check: answered(rig) })).toBe(true)
    expect((await typesOf(rig)).filter((type) => type === 'session-start-failed')).toHaveLength(1)
  })

  it('records a transient failure only after the fifth consecutive attempt', async () => {
    const fault = faultingRuntime({
      times: 5,
      error: () => new Error('db blip'),
    })
    const rig = await makeRig({ beforeRuntime: fault.beforeRuntime })
    await seedSession(rig)
    await rig.post('hello')
    await rig.holder.start()
    await rig.wake()
    expect(await retryUntil(rig, recorded(rig))).toBe(true)
    expect(fault.state.attempts).toBe(5)
    expect(await startFailure(rig)).toMatchObject({
      permanent: false,
      reason: 'db blip',
    })

    rig.clock.advance(5 * 60_000)
    await rig.flush()
    expect(fault.state.attempts).toBe(5)
    const { lease } = await rig.plane.currentLease({ sessionId: SESSION })
    expect(lease.wantsHolder).toBe(false)
  })

  it('records nothing when a transient failure recovers', async () => {
    const fault = faultingRuntime({
      times: 2,
      error: () => new Error('db blip'),
    })
    const rig = await makeRig({ beforeRuntime: fault.beforeRuntime })
    await seedSession(rig)
    await rig.post('hello')
    await rig.holder.start()
    await rig.wake()
    expect(await retryUntil(rig, answered(rig))).toBe(true)
    expect(await typesOf(rig)).not.toContain('session-start-failed')
    expect(fault.state.attempts).toBe(3)
  })
})
