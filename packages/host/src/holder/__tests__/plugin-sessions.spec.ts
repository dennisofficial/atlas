import { describe, expect, it } from 'bun:test'

import { EEffort, toThreadId } from '@dltech/atlas-core'
import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'

import { podSessionsOf } from '../plugin-sessions'
import type { HostStepPort } from '../record/host-step'

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

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const rig = async (options: { step?: HostStepPort; threadId?: string } = {}) => {
  const plane = new ControlPlane({
    store: new InMemoryControlStore({ clock: () => T0 }),
    clock: () => T0,
  })
  await plane.createSession(SPAWNER)
  return {
    plane,
    sessions: podSessionsOf({
      plane,
      sessionId: SPAWNER.sessionId,
      model: () => TEAMMATE_MODEL,
      ...(options.step === undefined ? {} : { step: options.step }),
      ...(options.threadId === undefined ? {} : { threadId: toThreadId(options.threadId) }),
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

  it('mints a different session every time without a call scope', async () => {
    const { sessions } = await rig()
    const first = await sessions.spawn({})
    const second = await sessions.spawn({})
    expect(first.sessionId).not.toBe(second.sessionId)
    expect(first.mainThreadId).not.toBe(second.mainThreadId)
  })

  it('derives one session, and its thread, from the step key', async () => {
    const requests: { op: string; input: object }[] = []
    const step: HostStepPort = async (request) => {
      requests.push(request)
      return { key: 'host.1.sessions.spawn.h0', replayed: true }
    }
    const { plane, sessions } = await rig({ step, threadId: 't1' })
    const first = await sessions.spawn({ title: 'the peer', brief: 'read the port' })
    const second = await sessions.spawn({ title: 'the peer', brief: 'read the port' })
    expect(second).toEqual(first)
    expect(first.sessionId).toMatch(UUID_V4)
    expect(first.mainThreadId).toMatch(UUID_V4)
    expect(first.mainThreadId).not.toBe(first.sessionId)
    expect(requests[0]).toMatchObject({
      op: 'sessions.spawn',
      input: { title: 'the peer', brief: 'read the port' },
    })
    expect(await inboxOf(plane, first.sessionId)).toHaveLength(1)
  })

  it('derives a session of its own for each step key', async () => {
    let key = 'host.1.sessions.spawn.h0'
    const step: HostStepPort = async () => ({ key, replayed: false })
    const { sessions } = await rig({ step, threadId: 't1' })
    const first = await sessions.spawn({})
    key = 'host.1.sessions.spawn.h1'
    const second = await sessions.spawn({})
    expect(second.sessionId).not.toBe(first.sessionId)
    expect(second.mainThreadId).not.toBe(first.mainThreadId)
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
