import { describe, expect, it } from 'bun:test'

import { UnknownThreadError } from '@dltech/atlas-control'

import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID, type HolderRig } from './holder-rig'

const OTHER = 'session-other'
const OTHER_THREAD = 'thread-other'

const seedOther = async (rig: HolderRig): Promise<void> => {
  await rig.plane.createSession({
    sessionId: OTHER,
    userId: 'user-1',
    projectId: 'project-1',
    mainThreadId: OTHER_THREAD,
  })
}

const failAppendsFor = (args: { rig: HolderRig; error: () => Error }): (() => void) => {
  const original = args.rig.plane.append.bind(args.rig.plane)
  let armed = false
  args.rig.plane.append = (async (params: Parameters<typeof original>[0]) => {
    if (armed && params.threadId === THREAD_ID) throw args.error()
    return original(params)
  }) as typeof args.rig.plane.append
  return () => {
    armed = true
  }
}

const trackAbandons = (rig: HolderRig): number[] => {
  const abandoned: number[] = []
  const originalAbandon = rig.presence.abandon.bind(rig.presence)
  rig.presence.abandon = async (hostId) => {
    abandoned.push(hostId)
    await originalAbandon(hostId)
  }
  return abandoned
}

const holdBothSessions = async (rig: HolderRig): Promise<void> => {
  await seedSession(rig)
  await seedOther(rig)
  await rig.holder.start()
  await rig.post('first')
  await rig.plane.post({
    sessionId: OTHER,
    kind: 'message',
    payload: JSON.stringify({ text: 'first', via: 'operator' }),
  })
  await rig.wake()
  await rig.bus.wake(OTHER)
  const held = await flushUntil({
    check: () => rig.holder.heldIds().length === 2,
    clock: rig.clock,
  })
  expect(held).toBe(true)
}

const epochOf = async (rig: HolderRig, sessionId: string): Promise<number> =>
  (await rig.plane.currentLease({ sessionId })).lease.epoch

const holdHandedBack = async (args: {
  rig: HolderRig
  sessionId: string
  epoch: number
  clock?: HolderRig['clock'] | undefined
}): Promise<boolean> =>
  flushUntil({
    check: async () => (await epochOf(args.rig, args.sessionId)) > args.epoch,
    ...(args.clock === undefined
      ? { attempts: 400 }
      : { clock: args.clock, advanceMs: 500, attempts: 3_000 }),
  })

const poisonSession = async (rig: HolderRig): Promise<void> => {
  await rig.post('poison')
  await rig.wake()
}

describe('SessionHolder append failures stay inside the failing session', () => {
  it('a generic append error ends only that session once the retry budget is spent', async () => {
    const rig = await makeRig({
      appendRetryMs: 1_000,
      script: [{ text: 'ok' }],
      runningShells: async () => 1,
    })
    const arm = failAppendsFor({ rig, error: () => new Error('store unreachable') })
    const abandoned = trackAbandons(rig)
    await holdBothSessions(rig)
    const epoch = await epochOf(rig, SESSION)
    const clockAtArm = rig.clock.now()
    arm()
    await poisonSession(rig)

    const ended = await holdHandedBack({ rig, sessionId: SESSION, epoch, clock: rig.clock })

    expect(ended).toBe(true)
    expect(rig.clock.now() - clockAtArm).toBeGreaterThanOrEqual(1_000)
    expect((await rig.events()).filter((event) => event.type === 'user-said')).toHaveLength(1)
    expect(abandoned).toEqual([])
    expect(rig.holder.heldIds()).toContain(OTHER)
  }, 20_000)

  it('an UnknownThreadError fails the session at once, without waiting out the retry budget', async () => {
    const rig = await makeRig({
      appendRetryMs: 30_000,
      script: [{ text: 'ok' }],
      runningShells: async () => 1,
    })
    const arm = failAppendsFor({ rig, error: () => new UnknownThreadError(THREAD_ID) })
    const abandoned = trackAbandons(rig)
    await holdBothSessions(rig)
    const epoch = await epochOf(rig, SESSION)
    const clockAtArm = rig.clock.now()
    arm()
    await poisonSession(rig)

    const ended = await holdHandedBack({ rig, sessionId: SESSION, epoch })

    expect(ended).toBe(true)
    expect(rig.clock.now()).toBe(clockAtArm)
    expect(abandoned).toEqual([])
    expect(rig.holder.heldIds()).toContain(OTHER)
  }, 20_000)
})
