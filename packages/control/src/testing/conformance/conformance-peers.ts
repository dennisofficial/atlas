import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { ControlPlane } from '../../control-plane'
import type { ConformanceParams } from './conformance'
import { freshHosts } from './conformance-fresh-hosts'
import { createSessionParams, PROJECT, SESSION, THREAD, T0, USER } from './support'

const LATER = '2026-11-09T11:00:00.000Z'

export function describeControlPlanePeers(params: ConformanceParams): void {
  describe(`ControlPlane peer sessions (${params.name})`, () => {
    let plane: ControlPlane
    let now: string
    const hosts = freshHosts(params)

    beforeEach(async () => {
      await params.reset()
      now = T0
      plane = new ControlPlane({ store: params.makeStore(), clock: () => now })
    })

    afterEach(() => hosts.releaseAll())

    const spawn = (args: {
      sessionId: string
      mainThreadId: string
      brief?: string | undefined
      spawner?: string | undefined
      intoPod?: boolean | undefined
    }) =>
      plane.spawnPeer({
        spawnerSessionId: args.spawner ?? SESSION,
        sessionId: args.sessionId,
        mainThreadId: args.mainThreadId,
        title: 'Peer session',
        ...(args.brief === undefined ? {} : { brief: args.brief }),
        ...(args.intoPod === undefined ? {} : { intoPod: args.intoPod }),
      })

    it('links a spawned session to its spawner with no pod of its own', async () => {
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
        podSessionId: null,
        projectId: PROJECT,
        userId: USER,
        title: 'Peer session',
      })
      const inbox = await plane.readInbox({ sessionId: 'peer-1', afterId: 0, limit: 10 })
      expect(inbox.map((entry) => entry.kind)).toEqual(['message'])
      expect(inbox[0]?.senderSessionId).toBe(SESSION)
      expect(JSON.parse(inbox[0]?.payload ?? '{}')).toEqual({ text: 'Take the parser.' })
    })

    it('places a teammate on the spawner’s pod', async () => {
      await plane.createSession(createSessionParams({ sessionId: SESSION, mainThreadId: THREAD }))
      await spawn({ sessionId: 'peer-1', mainThreadId: 'peer-thread-1', intoPod: true })
      expect((await plane.readSession({ sessionId: 'peer-1' }))?.podSessionId).toBe(SESSION)
      expect(
        await plane.podPeersPlaced({ podSessionId: SESSION, excludeSessionId: 'peer-1' }),
      ).toBe(1)
    })

    it('refuses a teammate that asks for a teammate of its own', async () => {
      await plane.createSession(createSessionParams({ sessionId: SESSION, mainThreadId: THREAD }))
      await spawn({ sessionId: 'peer-1', mainThreadId: 'peer-thread-1', intoPod: true })
      await expect(
        spawn({
          sessionId: 'peer-2',
          mainThreadId: 'peer-thread-2',
          spawner: 'peer-1',
          intoPod: true,
        }),
      ).rejects.toThrow('a teammate cannot create another teammate')
      expect(await plane.readSession({ sessionId: 'peer-2' })).toBeUndefined()
    })

    it('lets a teammate spawn an ordinary session with no pod', async () => {
      await plane.createSession(createSessionParams({ sessionId: SESSION, mainThreadId: THREAD }))
      await spawn({ sessionId: 'peer-1', mainThreadId: 'peer-thread-1', intoPod: true })
      await spawn({ sessionId: 'peer-2', mainThreadId: 'peer-thread-2', spawner: 'peer-1' })
      expect(await plane.readSession({ sessionId: 'peer-2' })).toMatchObject({
        spawnedBySessionId: 'peer-1',
        podSessionId: null,
      })
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

    it('lists every session of the user, the current one included', async () => {
      await plane.createSession(createSessionParams({ sessionId: SESSION, mainThreadId: THREAD }))
      now = '2026-11-09T10:00:01.000Z'
      await spawn({ sessionId: 'peer-1', mainThreadId: 'peer-thread-1' })
      now = '2026-11-09T10:00:02.000Z'
      await plane.createSession(
        createSessionParams({ sessionId: 'other', mainThreadId: 'other-thread' }),
      )
      await plane.createSession({
        sessionId: 'foreign',
        userId: 'another-user',
        projectId: PROJECT,
        mainThreadId: 'foreign-thread',
      })
      const roster = await plane.sessionsOf({ sessionId: 'peer-1' })
      expect(roster.sessions.map((row) => row.sessionId)).toEqual(['other', 'peer-1', SESSION])
      expect(roster.sessions.find((row) => row.sessionId === 'peer-1')?.spawnedBySessionId).toBe(
        SESSION,
      )
    })

    it('archives a spawned session without touching its spawner', async () => {
      await plane.createSession(createSessionParams({ sessionId: SESSION, mainThreadId: THREAD }))
      await spawn({ sessionId: 'peer-1', mainThreadId: 'peer-thread-1', intoPod: true })
      await plane.setSessionArchived({ sessionId: 'peer-1', archivedAt: LATER })
      expect((await plane.readSession({ sessionId: 'peer-1' }))?.archivedAt).toBe(LATER)
      expect((await plane.readSession({ sessionId: SESSION }))?.archivedAt).toBeNull()
    })

    it('counts every other session placed on a pod, a root session’s own id included', async () => {
      await plane.createSession(createSessionParams({ sessionId: SESSION, mainThreadId: THREAD }))
      await spawn({ sessionId: 'peer-1', mainThreadId: 'peer-thread-1', intoPod: true })
      const placed = (podSessionId: string, excludeSessionId: string) =>
        plane.podPeersPlaced({ podSessionId, excludeSessionId })
      expect((await plane.readSession({ sessionId: SESSION }))?.podSessionId).toBeNull()
      expect(await placed(SESSION, 'peer-1')).toBe(1)
      expect(await placed(SESSION, SESSION)).toBe(1)
      expect(await placed('another-pod', SESSION)).toBe(0)
      await plane.setSessionArchived({ sessionId: 'peer-1', archivedAt: T0 })
      expect(await placed(SESSION, SESSION)).toBe(1)
      await spawn({ sessionId: 'peer-2', mainThreadId: 'peer-thread-2', intoPod: true })
      expect(await placed(SESSION, SESSION)).toBe(2)
    })
  })
}
