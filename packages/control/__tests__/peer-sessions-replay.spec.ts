import { describe, expect, it } from 'bun:test'

import { ControlPlane } from '../src'
import { spawnBriefClientIdOf } from '../src/peer-sessions'
import { InMemoryControlStore } from '../src/testing/memory'

const T0 = '2026-11-09T10:00:00.000Z'
const SPAWNER = { sessionId: 's1', mainThreadId: 't1', userId: 'u1', projectId: 'p1' }
const OTHER = { sessionId: 's2', mainThreadId: 't2', userId: 'u1', projectId: 'p1' }

const rig = async () => {
  const plane = new ControlPlane({
    store: new InMemoryControlStore({ clock: () => T0 }),
    clock: () => T0,
  })
  await plane.createSession(SPAWNER)
  await plane.createSession(OTHER)
  return plane
}

const inboxOf = async (plane: ControlPlane, sessionId: string) =>
  await plane.readInbox({ sessionId, afterId: 0, limit: 50 })

describe('spawnPeer replay', () => {
  it('answers the session it already made, and posts the brief once', async () => {
    const plane = await rig()
    const first = await plane.spawnPeer({
      spawnerSessionId: SPAWNER.sessionId,
      sessionId: 'new-1',
      mainThreadId: 'new-t1',
      brief: 'read the port',
    })
    const second = await plane.spawnPeer({
      spawnerSessionId: SPAWNER.sessionId,
      sessionId: 'new-1',
      mainThreadId: 'new-t1',
      brief: 'read the port',
    })
    expect(first).toMatchObject({ already: false })
    expect(second).toMatchObject({ inboxId: (first as { inboxId: number }).inboxId })
    expect(second).toMatchObject({ already: true })
    const inbox = await inboxOf(plane, 'new-1')
    expect(inbox).toHaveLength(1)
    expect(inbox[0]?.payload).toContain('read the port')
    expect(JSON.parse(inbox[0]?.payload ?? '{}')).toMatchObject({
      clientId: spawnBriefClientIdOf('new-1'),
    })
  })

  it('posts a brief a crash lost between the session and its message', async () => {
    const plane = await rig()
    await plane.spawnPeer({
      spawnerSessionId: SPAWNER.sessionId,
      sessionId: 'new-2',
      mainThreadId: 'new-t2',
    })
    expect(await inboxOf(plane, 'new-2')).toHaveLength(0)
    await plane.spawnPeer({
      spawnerSessionId: SPAWNER.sessionId,
      sessionId: 'new-2',
      mainThreadId: 'new-t2',
      brief: 'read the port',
    })
    expect(await inboxOf(plane, 'new-2')).toHaveLength(1)
  })

  it('refuses a session that exists under another spawner', async () => {
    const plane = await rig()
    await plane.spawnPeer({
      spawnerSessionId: OTHER.sessionId,
      sessionId: 'taken',
      mainThreadId: 'taken-t',
    })
    const replay = await plane.spawnPeer({
      spawnerSessionId: SPAWNER.sessionId,
      sessionId: 'taken',
      mainThreadId: 'taken-t',
    })
    expect(replay).toEqual({
      refused: 'the session taken already exists and this session did not create it',
    })
    expect(await plane.readSession({ sessionId: 'taken' })).toMatchObject({
      spawnedBySessionId: OTHER.sessionId,
    })
  })
})

describe('peer messages keyed by a client id', () => {
  it('posts a repeated message once, and answers the same inbox id', async () => {
    const plane = await rig()
    const first = await plane.messagePeer({
      fromSessionId: SPAWNER.sessionId,
      toSessionId: OTHER.sessionId,
      text: 'the report',
      clientId: 'host-1.messages.0',
    })
    const second = await plane.messagePeer({
      fromSessionId: SPAWNER.sessionId,
      toSessionId: OTHER.sessionId,
      text: 'the report',
      clientId: 'host-1.messages.0',
    })
    expect(second).toEqual(first)
    expect(await inboxOf(plane, OTHER.sessionId)).toHaveLength(1)
  })

  it('posts a repeated report to the spawner once', async () => {
    const plane = await rig()
    await plane.spawnPeer({
      spawnerSessionId: SPAWNER.sessionId,
      sessionId: 'child',
      mainThreadId: 'child-t',
    })
    const first = await plane.reportToSpawner({
      sessionId: 'child',
      text: 'done',
      clientId: 'host-1.messages.1',
    })
    const second = await plane.reportToSpawner({
      sessionId: 'child',
      text: 'done',
      clientId: 'host-1.messages.1',
    })
    expect(second).toEqual(first)
    expect(await inboxOf(plane, SPAWNER.sessionId)).toHaveLength(1)
  })
})
