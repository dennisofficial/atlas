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
    payload: JSON.stringify({ text: 'first' }),
  })
  await rig.wake()
  await rig.bus.wake(OTHER)
  const held = await flushUntil({
    check: () => rig.holder.heldIds().length === 2,
    clock: rig.clock,
  })
  expect(held).toBe(true)
}

const poisonSession = async (rig: HolderRig): Promise<void> => {
  await rig.post('poison')
  await rig.wake()
}

describe('SessionHolder append failures stay inside the failing session', () => {
  it('a generic append error ends only that session once the retry budget is spent', async () => {
    const rig = await makeRig({ appendRetryMs: 1_000, script: [{ text: 'ok' }] })
    const arm = failAppendsFor({ rig, error: () => new Error('store unreachable') })
    const abandoned = trackAbandons(rig)
    await holdBothSessions(rig)
    arm()
    await poisonSession(rig)

    const ended = await flushUntil({
      check: () => !rig.holder.heldIds().includes(SESSION),
      clock: rig.clock,
      advanceMs: 500,
      attempts: 3000,
    })

    expect(ended).toBe(true)
    expect(abandoned).toEqual([])
    expect(rig.holder.heldIds()).toContain(OTHER)
  }, 20_000)

  it('an UnknownThreadError fails the session at once, without waiting out the retry budget', async () => {
    const rig = await makeRig({ appendRetryMs: 30_000, script: [{ text: 'ok' }] })
    const arm = failAppendsFor({ rig, error: () => new UnknownThreadError(THREAD_ID) })
    const abandoned = trackAbandons(rig)
    await holdBothSessions(rig)
    arm()
    await poisonSession(rig)

    const ended = await flushUntil({
      check: () => !rig.holder.heldIds().includes(SESSION),
      attempts: 200,
    })

    expect(ended).toBe(true)
    expect(rig.clock.now()).toBe(0)
    expect(abandoned).toEqual([])
    expect(rig.holder.heldIds()).toContain(OTHER)
  }, 20_000)
})
