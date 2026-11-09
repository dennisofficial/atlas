import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { ControlPlane } from '../../control-plane'
import { PEER_MESSAGE_BUDGET } from '../../peer-sessions'
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

    it('posts with the sender named and refuses the message past the budget', async () => {
      await plane.createSession(createSessionParams({ sessionId: SESSION, mainThreadId: THREAD }))
      await spawn({ sessionId: 'peer-1', mainThreadId: 'peer-thread-1' })
      for (let index = 0; index < PEER_MESSAGE_BUDGET; index += 1) {
        const sent = await plane.messagePeer({
          fromSessionId: SESSION,
          toSessionId: 'peer-1',
          text: `m${index}`,
        })
        expect(sent).toEqual({ inboxId: index + 1 })
      }
      const refused = await plane.messagePeer({
        fromSessionId: SESSION,
        toSessionId: 'peer-1',
        text: 'one too many',
      })
      expect(refused).toMatchObject({ refused: expect.stringContaining('20') })
      const inbox = await plane.readInbox({ sessionId: 'peer-1', afterId: 0, limit: 100 })
      expect(inbox.length).toBe(PEER_MESSAGE_BUDGET)
      expect(inbox[0]?.senderSessionId).toBe(SESSION)
      expect(JSON.parse(inbox[0]?.payload ?? '{}')).toEqual({ text: 'm0' })
      expect((await plane.readSession({ sessionId: 'peer-1' }))?.peerMessagesSent).toBe(
        PEER_MESSAGE_BUDGET,
      )
    })

    it('lets a peer reply without spending its own budget, and resets by the operator', async () => {
      await plane.createSession(createSessionParams({ sessionId: SESSION, mainThreadId: THREAD }))
      await spawn({ sessionId: 'peer-1', mainThreadId: 'peer-thread-1' })
      const reply = await plane.messagePeer({
        fromSessionId: 'peer-1',
        toSessionId: SESSION,
        text: 'done',
      })
      expect(reply).toEqual({ inboxId: 1 })
      expect((await plane.readSession({ sessionId: 'peer-1' }))?.peerMessagesSent).toBe(0)
      await plane.messagePeer({ fromSessionId: SESSION, toSessionId: 'peer-1', text: 'm' })
      expect((await plane.readSession({ sessionId: 'peer-1' }))?.peerMessagesSent).toBe(1)
      expect(await plane.resetPeerBudget({ sessionId: 'peer-1' })).toBe(true)
      expect((await plane.readSession({ sessionId: 'peer-1' }))?.peerMessagesSent).toBe(0)
      expect(await plane.resetPeerBudget({ sessionId: 'nope' })).toBe(false)
    })

    it('refuses a message between sessions with no spawn link', async () => {
      await plane.createSession(createSessionParams({ sessionId: SESSION, mainThreadId: THREAD }))
      await plane.createSession(
        createSessionParams({ sessionId: 'stranger', mainThreadId: 'stranger-thread' }),
      )
      const refused = await plane.messagePeer({
        fromSessionId: SESSION,
        toSessionId: 'stranger',
        text: 'hello',
      })
      expect(refused).toMatchObject({ refused: expect.stringContaining('spawned') })
      expect(await plane.readInbox({ sessionId: 'stranger', afterId: 0, limit: 10 })).toEqual([])
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
