import { describe, expect, it } from 'bun:test'

import { EMessageOrigin, EReportKind, toRunId, toThreadId } from '@dltech/atlas-core'
import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'

import { InboxIntake } from '../inbox-intake'
import { podSessionsOf } from '../plugin-sessions'
import type { SessionRecord } from '../record/record-adapter'

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
const STRANGER = {
  sessionId: 'stranger',
  mainThreadId: 't8',
  userId: 'u2',
  projectId: 'p1',
}

const rig = async () => {
  const plane = new ControlPlane({
    store: new InMemoryControlStore({ clock: () => T0 }),
    clock: () => T0,
  })
  await plane.createSession(SPAWNER)
  return {
    plane,
    sessions: podSessionsOf({ plane, sessionId: SPAWNER.sessionId }),
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

  it('messages a nested teammate but refuses a flat spawn', async () => {
    const { plane, sessions } = await rig()
    await plane.createSession(OTHER)
    const teammate = await sessions.spawn({ nested: true })
    const flat = await sessions.spawn({ nested: false })
    expect(
      await sessions.messageTeammate({ sessionId: teammate.sessionId, text: 'how is it going' }),
    ).toEqual({ queued: true })
    expect(await inboxOf(plane, teammate.sessionId)).toHaveLength(1)
    expect(await sessions.messageTeammate({ sessionId: flat.sessionId, text: 'hello' })).toEqual({
      refused: `session ${flat.sessionId} is not one of this session’s nested teammates`,
    })
    expect(await sessions.messageTeammate({ sessionId: OTHER.sessionId, text: 'hello' })).toEqual({
      refused: `session ${OTHER.sessionId} is not one of this session’s nested teammates`,
    })
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
    const sent = await sessions.message({
      sessionId: peer.sessionId,
      text: 'how is it going',
    })
    expect(sent).toEqual({ queued: true })
    const inbox = await inboxOf(plane, peer.sessionId)
    expect(inbox[0]?.senderSessionId).toBe(SPAWNER.sessionId)
    expect(JSON.parse(inbox[0]?.payload ?? '{}')).toEqual({
      text: 'how is it going',
    })
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

  it('sends any number of messages, with no budget', async () => {
    const { sessions } = await rig()
    const peer = await sessions.spawn({})
    for (let index = 0; index < 25; index += 1) {
      expect(
        await sessions.message({
          sessionId: peer.sessionId,
          text: `m${index}`,
        }),
      ).toEqual({
        queued: true,
      })
    }
  })

  it('messages any session of the same user, spawned by this one or not', async () => {
    const { plane, sessions } = await rig()
    await plane.createSession(OTHER)
    expect(await sessions.message({ sessionId: OTHER.sessionId, text: 'hello' })).toEqual({
      queued: true,
    })
    const inbox = await inboxOf(plane, OTHER.sessionId)
    expect(inbox[0]?.senderSessionId).toBe(SPAWNER.sessionId)
  })

  it('refuses a session of another user and posts nothing', async () => {
    const { plane, sessions } = await rig()
    await plane.createSession(STRANGER)
    const refused = await sessions.message({
      sessionId: STRANGER.sessionId,
      text: 'hello',
    })
    expect('refused' in refused && refused.refused).toContain('no session')
    expect(await inboxOf(plane, STRANGER.sessionId)).toHaveLength(0)
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
    }).spawn({})
    expect(await plane.readSession({ sessionId: nested.sessionId })).toMatchObject({
      spawnedBySessionId: child.sessionId,
      podSessionId: null,
    })
  })

  it('reports to the spawner as a message from the reporting session', async () => {
    const { plane, sessions } = await rig()
    const child = await sessions.spawn({})
    const sent = await podSessionsOf({
      plane,
      sessionId: child.sessionId,
    }).report({
      kind: EReportKind.Done,
      text: 'the parser is green',
    })
    expect(sent).toEqual({ queued: true })
    const inbox = await inboxOf(plane, SPAWNER.sessionId)
    expect(inbox).toHaveLength(1)
    expect(inbox[0]?.senderSessionId).toBe(child.sessionId)
    expect(JSON.parse(inbox[0]?.payload ?? '{}')).toEqual({
      text: 'the parser is green',
    })
  })

  it('reaches the spawner’s intake in the agent lane', async () => {
    const { plane, sessions } = await rig()
    const child = await sessions.spawn({})
    await podSessionsOf({ plane, sessionId: child.sessionId }).report({
      kind: EReportKind.NeedsDecision,
      text: 'which parser',
    })
    const drain = await new InboxIntake({
      plane,
      sessionId: SPAWNER.sessionId,
      record: {} as SessionRecord,
      threadId: toThreadId(SPAWNER.mainThreadId),
      runId: () => toRunId('run-1'),
    }).prepare()
    expect(drain.drafts).toEqual([
      {
        type: 'user-said',
        text: 'which parser',
        sender: { session: child.sessionId },
        via: EMessageOrigin.PeerAgent,
        requestId: 'inbox:1',
        inboxId: 1,
      },
    ])
  })

  it('refuses a report from a session it did not spawn, and posts nothing', async () => {
    const { plane, sessions } = await rig()
    const refused = await sessions.report({
      kind: EReportKind.Done,
      text: 'nothing to say',
    })
    expect('refused' in refused && refused.refused).toContain('no spawner')
    expect(await inboxOf(plane, SPAWNER.sessionId)).toHaveLength(0)
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
