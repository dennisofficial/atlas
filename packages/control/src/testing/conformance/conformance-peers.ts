import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { ControlPlane } from '../../control-plane'
import type { ConformanceParams } from './conformance'
import { freshHosts } from './conformance-fresh-hosts'
import { createSessionParams, PROJECT, SESSION, THREAD, T0, USER } from './support'

export function describeControlPlanePeers(params: ConformanceParams): void {
  describe(`ControlPlane peer sessions (${params.name})`, () => {
    let plane: ControlPlane
    const hosts = freshHosts(params)

    beforeEach(async () => {
      await params.reset()
      plane = new ControlPlane({ store: params.makeStore(), clock: () => T0 })
    })

    afterEach(() => hosts.releaseAll())

    const spawn = (args: {
      sessionId: string
      mainThreadId: string
      brief?: string | undefined
      spawner?: string | undefined
    }) =>
      plane.spawnPeer({
        spawnerSessionId: args.spawner ?? SESSION,
        sessionId: args.sessionId,
        mainThreadId: args.mainThreadId,
        title: 'Peer session',
        ...(args.brief === undefined ? {} : { brief: args.brief }),
      })

    it('links a spawned session to its spawner and places it on the spawner’s pod', async () => {
      await plane.createSession(createSessionParams({ sessionId: SESSION, mainThreadId: THREAD }))
      const { inboxId } = await spawn({
        sessionId: 'peer-1',
        mainThreadId: 'peer-thread-1',
        brief: 'Take the parser.',
      })
      expect(inboxId).toBe(1)
      const peer = await plane.readSession({ sessionId: 'peer-1' })
      expect(peer).toMatchObject({
        spawnedBySessionId: SESSION,
        podSessionId: SESSION,
        projectId: PROJECT,
        userId: USER,
        title: 'Peer session',
      })
      const inbox = await plane.readInbox({ sessionId: 'peer-1', afterId: 0, limit: 10 })
      expect(inbox.map((entry) => entry.kind)).toEqual(['message'])
      expect(inbox[0]?.senderSessionId).toBe(SESSION)
      expect(JSON.parse(inbox[0]?.payload ?? '{}')).toEqual({ text: 'Take the parser.' })
    })

    it('keeps a peer of a peer on the root pod', async () => {
      await plane.createSession(createSessionParams({ sessionId: SESSION, mainThreadId: THREAD }))
      await spawn({ sessionId: 'peer-1', mainThreadId: 'peer-thread-1' })
      await spawn({ sessionId: 'peer-2', mainThreadId: 'peer-thread-2', spawner: 'peer-1' })
      expect((await plane.readSession({ sessionId: 'peer-2' }))?.podSessionId).toBe(SESSION)
    })

    it('posts a message with the sender named', async () => {
      await plane.createSession(createSessionParams({ sessionId: SESSION, mainThreadId: THREAD }))
      await spawn({ sessionId: 'peer-1', mainThreadId: 'peer-thread-1' })
      const sent = await plane.messagePeer({
        fromSessionId: SESSION,
        toSessionId: 'peer-1',
        text: 'm0',
      })
      expect(sent).toEqual({ inboxId: 1 })
      const inbox = await plane.readInbox({ sessionId: 'peer-1', afterId: 0, limit: 100 })
      expect(inbox.length).toBe(1)
      expect(inbox[0]?.senderSessionId).toBe(SESSION)
      expect(JSON.parse(inbox[0]?.payload ?? '{}')).toEqual({ text: 'm0' })
    })

    it('lets two sessions of one user message each other with no spawn link', async () => {
      await plane.createSession(createSessionParams({ sessionId: SESSION, mainThreadId: THREAD }))
      await plane.createSession(
        createSessionParams({ sessionId: 'stranger', mainThreadId: 'stranger-thread' }),
      )
      const sent = await plane.messagePeer({
        fromSessionId: SESSION,
        toSessionId: 'stranger',
        text: 'hello',
      })
      expect(sent).toEqual({ inboxId: 1 })
      const inbox = await plane.readInbox({ sessionId: 'stranger', afterId: 0, limit: 10 })
      expect(inbox[0]?.senderSessionId).toBe(SESSION)
      expect(JSON.parse(inbox[0]?.payload ?? '{}')).toEqual({ text: 'hello' })
    })

    it('refuses a message to a session another user owns', async () => {
      await plane.createSession(createSessionParams({ sessionId: SESSION, mainThreadId: THREAD }))
      await plane.createSession({
        sessionId: 'foreign',
        userId: 'another-user',
        projectId: PROJECT,
        mainThreadId: 'foreign-thread',
      })
      const refused = await plane.messagePeer({
        fromSessionId: SESSION,
        toSessionId: 'foreign',
        text: 'hello',
      })
      expect(refused).toEqual({ refused: 'there is no session foreign in this project' })
      expect(await plane.readInbox({ sessionId: 'foreign', afterId: 0, limit: 10 })).toEqual([])
    })

    it('lists the peers a session spawned and the spawner it came from', async () => {
      await plane.createSession(createSessionParams({ sessionId: SESSION, mainThreadId: THREAD }))
      await spawn({ sessionId: 'peer-1', mainThreadId: 'peer-thread-1' })
      await plane.createSession(
        createSessionParams({ sessionId: 'other', mainThreadId: 'other-thread' }),
      )
      const fromSpawner = await plane.peersOf({ sessionId: SESSION })
      expect(fromSpawner.spawner).toBeNull()
      expect(fromSpawner.peers.map((row) => row.sessionId)).toEqual(['peer-1'])
      const fromPeer = await plane.peersOf({ sessionId: 'peer-1' })
      expect(fromPeer.spawner?.sessionId).toBe(SESSION)
      expect(fromPeer.peers).toEqual([])
    })

    it('counts every other session placed on a pod, a root session’s own id included', async () => {
      await plane.createSession(createSessionParams({ sessionId: SESSION, mainThreadId: THREAD }))
      await spawn({ sessionId: 'peer-1', mainThreadId: 'peer-thread-1' })
      const placed = (podSessionId: string, excludeSessionId: string) =>
        plane.podPeersPlaced({ podSessionId, excludeSessionId })
      expect((await plane.readSession({ sessionId: SESSION }))?.podSessionId).toBeNull()
      expect(await placed(SESSION, 'peer-1')).toBe(1)
      expect(await placed(SESSION, SESSION)).toBe(1)
      expect(await placed('another-pod', SESSION)).toBe(0)
      await plane.setSessionArchived({ sessionId: 'peer-1', archivedAt: T0 })
      expect(await placed(SESSION, SESSION)).toBe(1)
      await spawn({ sessionId: 'peer-2', mainThreadId: 'peer-thread-2', spawner: 'peer-1' })
      expect(await placed(SESSION, SESSION)).toBe(2)
    })
  })
}
