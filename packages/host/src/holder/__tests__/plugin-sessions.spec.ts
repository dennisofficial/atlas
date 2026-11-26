import { describe, expect, it } from 'bun:test'

import { EEffort } from '@dltech/atlas-core'
import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'

import { runInCallScope } from '../../calls/call-scope'
import { runHostStep, type EffectResultLookup, type HostStepFacts } from '../host-step'
import type { PodStepRunner } from '../plugin-context'
import { podSessionsOf } from '../plugin-sessions'
import type { StepRecord } from '../record/call-steps'

const CALL_SCOPE = '11111111-1111-4111-8111-111111111111'

const hostStepOf = (): { step: PodStepRunner; forget: () => void } => {
  const steps: StepRecord[] = []
  const results = new Map<string, unknown>()
  const facts: HostStepFacts = {
    recorded: () => steps.map((step) => ({ ...step })),
    record: async (step) => {
      steps.push(step)
    },
    result: <T>(stepKey: string): EffectResultLookup<T> => {
      const key = `effect-result:${stepKey}`
      return results.has(key) ? { found: true, value: results.get(key) as T } : { found: false }
    },
    recordResult: async (stepKey, value) => {
      results.set(`effect-result:${stepKey}`, value)
    },
  }
  return {
    step: { run: async (step) => await runHostStep({ facts, ...step }) },
    forget: () => results.clear(),
  }
}

const inCall = <T>(body: () => Promise<T>): Promise<T> =>
  runInCallScope({ scopeKey: CALL_SCOPE, body })

const steppedOf = (): PodStepRunner => {
  let next = 0
  return {
    run: async ({ run }) => {
      next += 1
      return await run(`step-${next}`)
    },
  }
}

const T0 = '2026-11-09T10:00:00.000Z'
const SPAWNER = {
  sessionId: 's1',
  mainThreadId: 't1',
  userId: 'u1',
  projectId: 'p1',
}
const OTHER = {
  sessionId: 'other',
  mainThreadId: 't9',
  userId: 'u1',
  projectId: 'p1',
}

const TEAMMATE_MODEL = {
  ref: { providerId: 'openai', modelId: 'gpt-5' },
  effort: EEffort.High,
  fast: true,
}

const LATER_TEAMMATE_MODEL = {
  ref: { providerId: 'anthropic', modelId: 'claude-sonnet-4-5' },
  effort: EEffort.Low,
  fast: false,
}

const rig = async () => {
  const plane = new ControlPlane({
    store: new InMemoryControlStore({ clock: () => T0 }),
    clock: () => T0,
  })
  await plane.createSession(SPAWNER)
  return {
    plane,
    sessions: podSessionsOf({
      step: steppedOf(),
      plane,
      sessionId: SPAWNER.sessionId,
      model: () => TEAMMATE_MODEL,
    }),
  }
}

const inboxOf = (plane: ControlPlane, sessionId: string) =>
  plane.readInbox({ sessionId, afterId: 0, limit: 50 })

describe('podSessionsOf', () => {
  it('spawns a session linked to the spawner, with a fresh thread and no pod', async () => {
    const { plane, sessions } = await rig()
    const spawned = await sessions.spawn({
      title: 'the peer',
      brief: 'read the port',
    })
    const row = await plane.readSession({ sessionId: spawned.sessionId })
    expect(spawned.mainThreadId).not.toBe(spawned.sessionId)
    expect(row).toMatchObject({
      sessionId: spawned.sessionId,
      mainThreadId: spawned.mainThreadId,
      title: 'the peer',
      spawnedBySessionId: SPAWNER.sessionId,
      nested: true,
      podSessionId: null,
      userId: SPAWNER.userId,
      projectId: SPAWNER.projectId,
    })
  })

  it('replays a spawn under the same step key into the session it already made', async () => {
    const { plane, sessions } = await rig()
    const fixed: PodStepRunner = { run: async ({ run }) => await run('call-1.0') }
    const replayable = () =>
      podSessionsOf({
        step: fixed,
        plane,
        sessionId: SPAWNER.sessionId,
        model: () => TEAMMATE_MODEL,
      })
    const first = await replayable().spawn({ title: 'the peer', brief: 'read the port' })
    const second = await replayable().spawn({ title: 'the peer', brief: 'read the port' })
    expect(second).toEqual(first)
    const roster = (await sessions.list()).filter((row) => row.spawnedBy === SPAWNER.sessionId)
    expect(roster.map((row) => row.sessionId)).toEqual([first.sessionId])
    expect(await inboxOf(plane, first.sessionId)).toHaveLength(1)
  })

  it('replays a spawn whose attached file changed between holders into the one session', async () => {
    const { plane, sessions } = await rig()
    const host = hostStepOf()
    const replayable = () =>
      podSessionsOf({
        step: host.step,
        plane,
        sessionId: SPAWNER.sessionId,
        model: () => TEAMMATE_MODEL,
      })
    const files = (text: string) => [{ path: 'plan.md', text }]
    const first = await inCall(
      async () => await replayable().spawn({ title: 'the peer', files: files('the first plan') }),
    )
    const second = await inCall(
      async () => await replayable().spawn({ title: 'the peer', files: files('the second plan') }),
    )
    expect(second).toEqual(first)
    const roster = (await sessions.list()).filter((row) => row.spawnedBy === SPAWNER.sessionId)
    expect(roster.map((row) => row.sessionId)).toEqual([first.sessionId])
    expect(await inboxOf(plane, first.sessionId)).toHaveLength(1)
  })

  it('makes one session when a holder crashed after the spawn and before its result fact', async () => {
    const { plane, sessions } = await rig()
    const host = hostStepOf()
    const replayable = () =>
      podSessionsOf({
        step: host.step,
        plane,
        sessionId: SPAWNER.sessionId,
        model: () => TEAMMATE_MODEL,
      })
    const first = await inCall(
      async () => await replayable().spawn({ title: 'the peer', brief: 'read the port' }),
    )
    host.forget()
    const replayed = await inCall(
      async () => await replayable().spawn({ title: 'the peer', brief: 'read the port' }),
    )
    expect(replayed).toEqual(first)
    const roster = (await sessions.list()).filter((row) => row.spawnedBy === SPAWNER.sessionId)
    expect(roster.map((row) => row.sessionId)).toEqual([first.sessionId])
    expect(await inboxOf(plane, first.sessionId)).toHaveLength(1)
  })

  it('creates a teammate on the model the pod resolved for the teammate type', async () => {
    const { plane, sessions } = await rig()
    const spawned = await sessions.spawn({ nested: true })
    expect(await plane.readSession({ sessionId: spawned.sessionId })).toMatchObject({
      modelRef: 'openai/gpt-5',
      modelEffort: 'high',
    })
  })

  it('reads the teammate model when it spawns, not when the pod was built', async () => {
    const { plane } = await rig()
    let model = TEAMMATE_MODEL
    const sessions = podSessionsOf({
      step: steppedOf(),
      plane,
      sessionId: SPAWNER.sessionId,
      model: () => model,
    })
    const first = await sessions.spawn({ nested: true })
    model = LATER_TEAMMATE_MODEL
    const second = await sessions.spawn({ nested: true })
    expect(await plane.readSession({ sessionId: first.sessionId })).toMatchObject({
      modelRef: 'openai/gpt-5',
      modelEffort: 'high',
    })
    expect(await plane.readSession({ sessionId: second.sessionId })).toMatchObject({
      modelRef: 'anthropic/claude-sonnet-4-5',
      modelEffort: 'low',
    })
  })

  it('spawns a flat session at the top level when asked', async () => {
    const { plane, sessions } = await rig()
    const spawned = await sessions.spawn({ brief: 'work beside me', nested: false })
    const row = await plane.readSession({ sessionId: spawned.sessionId })
    expect(row).toMatchObject({
      spawnedBySessionId: SPAWNER.sessionId,
      nested: false,
    })
  })

  it('mints a different session every time', async () => {
    const { sessions } = await rig()
    const first = await sessions.spawn({})
    const second = await sessions.spawn({})
    expect(first.sessionId).not.toBe(second.sessionId)
    expect(first.mainThreadId).not.toBe(second.mainThreadId)
  })

  it('lists only the sessions nested under this one as teammates', async () => {
    const { sessions } = await rig()
    const nested = await sessions.spawn({ title: 'nested', nested: true })
    const flat = await sessions.spawn({ title: 'flat', nested: false })
    const roster = await sessions.teammates()
    expect(roster.map((row) => row.sessionId)).toEqual([nested.sessionId])
    expect(roster[0]).toMatchObject({
      spawnedBy: SPAWNER.sessionId,
      nested: true,
      current: false,
    })
    expect(roster.map((row) => row.sessionId)).not.toContain(flat.sessionId)
  })

  it('delivers the brief as the peer first message, and nothing without one', async () => {
    const { plane, sessions } = await rig()
    const briefed = await sessions.spawn({ brief: 'read the port' })
    const bare = await sessions.spawn({})
    const briefedInbox = await inboxOf(plane, briefed.sessionId)
    expect(briefedInbox).toHaveLength(1)
    expect(briefedInbox[0]?.payload).toContain('read the port')
    expect(await inboxOf(plane, bare.sessionId)).toHaveLength(0)
  })

  it('gives every spawned session a pod of its own', async () => {
    const { plane, sessions } = await rig()
    const first = await sessions.spawn({ title: 'the first' })
    const second = await sessions.spawn({ title: 'the second' })
    expect((await plane.readSession({ sessionId: first.sessionId }))?.podSessionId).toBeNull()
    expect((await plane.readSession({ sessionId: second.sessionId }))?.podSessionId).toBeNull()
  })

  it('lets a spawned session spawn a session of its own', async () => {
    const { plane, sessions } = await rig()
    const child = await sessions.spawn({})
    const nested = await podSessionsOf({
      step: steppedOf(),
      plane,
      sessionId: child.sessionId,
      model: () => TEAMMATE_MODEL,
    }).spawn({})
    expect(await plane.readSession({ sessionId: nested.sessionId })).toMatchObject({
      spawnedBySessionId: child.sessionId,
      podSessionId: null,
    })
  })

  it('lists every session of the user with the current one marked', async () => {
    const { plane, sessions } = await rig()
    await plane.createSession(OTHER)
    const spawned = await sessions.spawn({ title: 'one' })
    const roster = await sessions.list()
    expect(roster.map((brief) => brief.sessionId).sort()).toEqual(
      [SPAWNER.sessionId, OTHER.sessionId, spawned.sessionId].sort(),
    )
    expect(roster.find((brief) => brief.sessionId === SPAWNER.sessionId)).toMatchObject({
      sessionId: SPAWNER.sessionId,
      title: null,
      spawnedBy: null,
      archivedAt: null,
      current: true,
    })
    expect(roster.find((brief) => brief.sessionId === SPAWNER.sessionId)?.status).toMatchObject({
      state: expect.any(String),
    })
    expect(roster.find((brief) => brief.sessionId === OTHER.sessionId)?.current).toBe(false)
    expect(roster.find((brief) => brief.sessionId === spawned.sessionId)).toMatchObject({
      title: 'one',
      spawnedBy: SPAWNER.sessionId,
      archivedAt: null,
      current: false,
    })
  })

  it('lists the same roster from a spawned session, with its spawner as provenance', async () => {
    const { plane, sessions } = await rig()
    const peer = await sessions.spawn({})
    const roster = await podSessionsOf({
      step: steppedOf(),
      plane,
      sessionId: peer.sessionId,
      model: () => TEAMMATE_MODEL,
    }).list()
    expect(roster.map((brief) => brief.sessionId)).toContain(SPAWNER.sessionId)
    expect(roster.find((brief) => brief.sessionId === peer.sessionId)).toMatchObject({
      sessionId: peer.sessionId,
      title: null,
      spawnedBy: SPAWNER.sessionId,
      archivedAt: null,
      current: true,
    })
  })
})
