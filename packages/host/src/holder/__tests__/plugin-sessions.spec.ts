import { describe, expect, it } from 'bun:test'

import { EMessageOrigin, toRunId, toThreadId } from '@dltech/atlas-core'
import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'

import { InboxIntake } from '../inbox-intake'
import { podSessionsOf } from '../plugin-sessions'
import type { SessionRecord } from '../record/record-adapter'

const T0 = '2026-11-09T10:00:00.000Z'
const BUDGET = 20
const SPAWNER = { sessionId: 's1', mainThreadId: 't1', userId: 'u1', projectId: 'p1' }
const OTHER = { sessionId: 'other', mainThreadId: 't9', userId: 'u1', projectId: 'p1' }

const rig = async () => {
  const plane = new ControlPlane({
    store: new InMemoryControlStore({ clock: () => T0 }),
    clock: () => T0,
  })
  await plane.createSession(SPAWNER)
  return { plane, sessions: podSessionsOf({ plane, sessionId: SPAWNER.sessionId }) }
}

const inboxOf = (plane: ControlPlane, sessionId: string) =>
  plane.readInbox({ sessionId, afterId: 0, limit: 50 })

describe('podSessionsOf', () => {
  it('spawns a session linked to the spawner, in its pod, with a fresh thread', async () => {
    const { plane, sessions } = await rig()
    const spawned = await sessions.spawn({ title: 'the peer', brief: 'read the port' })
    const row = await plane.readSession({ sessionId: spawned.sessionId })
    expect(spawned.mainThreadId).not.toBe(spawned.sessionId)
    expect(row).toMatchObject({
      sessionId: spawned.sessionId,
      mainThreadId: spawned.mainThreadId,
      title: 'the peer',
      spawnedBySessionId: SPAWNER.sessionId,
      podSessionId: SPAWNER.sessionId,
      userId: SPAWNER.userId,
      projectId: SPAWNER.projectId,
    })
  })

  it('mints a different session every time', async () => {
    const { sessions } = await rig()
    const first = await sessions.spawn({})
    const second = await sessions.spawn({})
    expect(first.sessionId).not.toBe(second.sessionId)
    expect(first.mainThreadId).not.toBe(second.mainThreadId)
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

  it('names the sender on the entry, not inside the payload, of a message to a peer', async () => {
    const { plane, sessions } = await rig()
    const peer = await sessions.spawn({})
    const sent = await sessions.message({ sessionId: peer.sessionId, text: 'how is it going' })
    expect(sent).toEqual({ queued: true })
    const inbox = await inboxOf(plane, peer.sessionId)
    expect(inbox[0]?.senderSessionId).toBe(SPAWNER.sessionId)
    expect(JSON.parse(inbox[0]?.payload ?? '{}')).toEqual({ text: 'how is it going' })
  })

  it('reaches the spawned session’s intake as a draft sent by the spawner', async () => {
    const { plane, sessions } = await rig()
    const spawned = await sessions.spawn({ brief: 'read the port' })
    const drain = await new InboxIntake({
      plane,
      sessionId: spawned.sessionId,
      record: {} as SessionRecord,
      threadId: toThreadId(spawned.mainThreadId),
      runId: () => toRunId('run-1'),
    }).prepare()
    expect(drain.drafts).toEqual([
      {
        type: 'user-said',
        text: 'read the port',
        sender: { session: SPAWNER.sessionId },
        via: EMessageOrigin.PeerAgent,
        requestId: 'inbox:1',
        inboxId: 1,
      },
    ])
  })

  it('refuses the message after the twentieth one', async () => {
    const { sessions } = await rig()
    const peer = await sessions.spawn({})
    for (let index = 0; index < BUDGET; index += 1) {
      expect(await sessions.message({ sessionId: peer.sessionId, text: `m${index}` })).toEqual({
        queued: true,
      })
    }
    const refused = await sessions.message({ sessionId: peer.sessionId, text: 'one too many' })
    expect('refused' in refused && refused.refused).toContain(String(BUDGET))
  })

  it('refuses a session this one neither spawned nor was spawned by', async () => {
    const { plane, sessions } = await rig()
    await plane.createSession(OTHER)
    const refused = await sessions.message({ sessionId: OTHER.sessionId, text: 'hello' })
    expect('refused' in refused && refused.refused).toContain('spawned')
    expect(await inboxOf(plane, OTHER.sessionId)).toHaveLength(0)
  })

  it('lists the peers this session spawned and none above it', async () => {
    const { sessions } = await rig()
    await sessions.spawn({ title: 'one' })
    await sessions.spawn({ title: 'two' })
    const roster = await sessions.list()
    expect(roster.spawner).toBeNull()
    expect(roster.peers.map((peer) => peer.title)).toEqual(['one', 'two'])
    expect(roster.peers.every((peer) => peer.spawnedBy === SPAWNER.sessionId)).toBe(true)
    expect(roster.peers.every((peer) => peer.archivedAt === null)).toBe(true)
  })

  it('names the spawner from a peer', async () => {
    const { plane, sessions } = await rig()
    const peer = await sessions.spawn({})
    const roster = await podSessionsOf({ plane, sessionId: peer.sessionId }).list()
    expect(roster.spawner).toEqual({
      sessionId: SPAWNER.sessionId,
      title: null,
      spawnedBy: null,
      archivedAt: null,
    })
    expect(roster.peers).toEqual([])
  })
})
