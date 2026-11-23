import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { EMessageOrigin, inboxEventOf, toThreadId } from '@dltech/atlas-core'

import { DEFAULT_SANDBOX_PROVIDER } from '@dltech/atlas-protocol'

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

    const spawn = async (args: {
      sessionId: string
      mainThreadId: string
      brief?: string | undefined
      nested?: boolean | undefined
      spawner?: string | undefined
    }) => {
      const spawned = await plane.spawnPeer({
        spawnerSessionId: args.spawner ?? SESSION,
        sessionId: args.sessionId,
        mainThreadId: args.mainThreadId,
        title: 'Peer session',
        ...(args.brief === undefined ? {} : { brief: args.brief }),
        ...(args.nested === undefined ? {} : { nested: args.nested }),
      })
      if ('refused' in spawned) throw new Error(`the spawn was refused: ${spawned.refused}`)
      return spawned
    }

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
      const inbox = await plane.readInbox({
        sessionId: 'peer-1',
        afterId: 0,
        limit: 10,
      })
      expect(inbox.map((entry) => entry.kind)).toEqual(['message'])
      expect(inbox[0]?.senderSessionId).toBe(SESSION)
      expect(JSON.parse(inbox[0]?.payload ?? '{}')).toEqual({
        text: 'Take the parser.',
        via: EMessageOrigin.PeerAgent,
      })
    })

    it('gives a spawned session the default sandbox provider, not its spawner one', async () => {
      await plane.createSession(createSessionParams({ sessionId: SESSION, mainThreadId: THREAD }))
      await spawn({ sessionId: 'peer-1', mainThreadId: 'peer-thread-1' })
      expect((await plane.readSession({ sessionId: SESSION }))?.sandboxProvider).toBe('vercel')
      expect((await plane.readSession({ sessionId: 'peer-1' }))?.sandboxProvider).toBe(
        DEFAULT_SANDBOX_PROVIDER,
      )
    })

    it('nests a spawned session by default and lets it be flat instead', async () => {
      await plane.createSession(createSessionParams({ sessionId: SESSION, mainThreadId: THREAD }))
      await spawn({ sessionId: 'peer-1', mainThreadId: 'peer-thread-1' })
      await spawn({ sessionId: 'peer-2', mainThreadId: 'peer-thread-2', nested: false })
      expect(await plane.readSession({ sessionId: 'peer-1' })).toMatchObject({
        spawnedBySessionId: SESSION,
        nested: true,
      })
      expect(await plane.readSession({ sessionId: 'peer-2' })).toMatchObject({
        spawnedBySessionId: SESSION,
        nested: false,
      })
      const roster = await plane.sessionsOf({ sessionId: SESSION })
      expect(roster.sessions.find((row) => row.sessionId === 'peer-1')?.nested).toBe(true)
      expect(roster.sessions.find((row) => row.sessionId === 'peer-2')?.nested).toBe(false)
    })

    it('gives two spawned sessions a pod each, never one shared', async () => {
      await plane.createSession(createSessionParams({ sessionId: SESSION, mainThreadId: THREAD }))
      const placed = () =>
        plane.podPeersPlaced({
          podSessionId: SESSION,
          excludeSessionId: SESSION,
        })
      const before = await placed()
      await spawn({ sessionId: 'peer-1', mainThreadId: 'peer-thread-1' })
      await spawn({ sessionId: 'peer-2', mainThreadId: 'peer-thread-2' })
      const first = await plane.readSession({ sessionId: 'peer-1' })
      const second = await plane.readSession({ sessionId: 'peer-2' })
      expect(first?.podSessionId).toBeNull()
      expect(second?.podSessionId).toBeNull()
      expect(await placed()).toBe(before)
      expect(first?.spawnedBySessionId).toBe(SESSION)
      expect(second?.spawnedBySessionId).toBe(SESSION)
    })

    it('lets a spawned session spawn a session of its own, with no pod shared', async () => {
      await plane.createSession(createSessionParams({ sessionId: SESSION, mainThreadId: THREAD }))
      await spawn({ sessionId: 'peer-1', mainThreadId: 'peer-thread-1' })
      await spawn({
        sessionId: 'peer-2',
        mainThreadId: 'peer-thread-2',
        spawner: 'peer-1',
      })
      expect(await plane.readSession({ sessionId: 'peer-2' })).toMatchObject({
        spawnedBySessionId: 'peer-1',
        podSessionId: null,
      })
    })

    it('posts a report to the spawner from the reporting session and wakes it', async () => {
      await plane.createSession(createSessionParams({ sessionId: SESSION, mainThreadId: THREAD }))
      await spawn({ sessionId: 'peer-1', mainThreadId: 'peer-thread-1' })
      const before = await params.wakes(SESSION)
      const sent = await plane.reportToSpawner({
        sessionId: 'peer-1',
        text: 'the parser is green',
      })
      expect(sent).toEqual({ inboxId: 1 })
      const inbox = await plane.readInbox({
        sessionId: SESSION,
        afterId: 0,
        limit: 10,
      })
      expect(inbox).toHaveLength(1)
      expect(inbox[0]?.senderSessionId).toBe('peer-1')
      expect(inbox[0]?.kind).toBe('event')
      const reported = inboxEventOf(inbox[0]?.payload ?? '')
      expect(
        reported.ok && reported.event.type === 'agent-reported' && reported.event,
      ).toMatchObject({
        agentId: toThreadId('peer-thread-1'),
        agentType: 'teammate',
        prose: 'the parser is green',
        senderSessionId: 'peer-1',
      })
      expect(await params.wakes(SESSION)).toBe(before + 1)
    })

    it('wakes the spawner for every report', async () => {
      await plane.createSession(createSessionParams({ sessionId: SESSION, mainThreadId: THREAD }))
      await spawn({ sessionId: 'peer-1', mainThreadId: 'peer-thread-1' })
      const before = await params.wakes(SESSION)
      expect(await plane.reportToSpawner({ sessionId: 'peer-1', text: 'halfway' })).toEqual({
        inboxId: 1,
      })
      expect(await plane.readInbox({ sessionId: SESSION, afterId: 0, limit: 10 })).toHaveLength(1)
      expect(await params.wakes(SESSION)).toBe(before + 1)
    })

    it('refuses a report from a session no other session created', async () => {
      await plane.createSession(createSessionParams({ sessionId: SESSION, mainThreadId: THREAD }))
      const refused = await plane.reportToSpawner({
        sessionId: SESSION,
        text: 'nothing to report to',
      })
      expect(refused).toEqual({
        refused: 'this session was not created by another session, so it has no spawner',
      })
      expect(await plane.readInbox({ sessionId: SESSION, afterId: 0, limit: 10 })).toEqual([])
    })

    it('lists every session of the user with its status, the current one included', async () => {
      await plane.createSession(createSessionParams({ sessionId: SESSION, mainThreadId: THREAD }))
      now = '2026-11-09T10:00:01.000Z'
      await spawn({ sessionId: 'peer-1', mainThreadId: 'peer-thread-1' })
      now = '2026-11-09T10:00:02.000Z'
      await plane.createSession(
        createSessionParams({
          sessionId: 'other',
          mainThreadId: 'other-thread',
        }),
      )
      await plane.createSession({
        sessionId: 'foreign',
        userId: 'another-user',
        projectId: PROJECT,
        mainThreadId: 'foreign-thread',
      })
      const roster = await plane.sessionsOf({ sessionId: 'peer-1' })
      expect(roster.sessions.map((row) => row.sessionId)).toEqual(['other', 'peer-1', SESSION])
      const peer = roster.sessions.find((row) => row.sessionId === 'peer-1')
      expect(peer?.spawnedBySessionId).toBe(SESSION)
      expect(peer?.view?.status.state).toBeString()
    })

    it('archives a spawned session without touching its spawner', async () => {
      await plane.createSession(createSessionParams({ sessionId: SESSION, mainThreadId: THREAD }))
      await spawn({ sessionId: 'peer-1', mainThreadId: 'peer-thread-1' })
      await plane.setSessionArchived({
        sessionId: 'peer-1',
        archivedAt: LATER,
      })
      expect((await plane.readSession({ sessionId: 'peer-1' }))?.archivedAt).toBe(LATER)
      expect((await plane.readSession({ sessionId: SESSION }))?.archivedAt).toBeNull()
    })
  })
}
