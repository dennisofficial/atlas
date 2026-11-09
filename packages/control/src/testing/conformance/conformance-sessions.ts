import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { ControlPlane } from '../../control-plane'
import {
  createSessionParams,
  HOLDER_HOST,
  mint,
  PROJECT,
  SESSION,
  T0,
  THREAD,
  USER,
} from './support'
import type { ConformanceParams } from './conformance'
import { freshHosts } from './conformance-fresh-hosts'
import { describeControlPlaneStartFailures } from './conformance-start-failure'

const after = (params: { iso: string; offsetMs: number }): string =>
  new Date(Date.parse(params.iso) + params.offsetMs).toISOString()

export function describeControlPlaneSessions(params: ConformanceParams): void {
  describeControlPlaneStartFailures(params)
  describe(`ControlPlane sessions (${params.name})`, () => {
    let plane: ControlPlane
    const hosts = freshHosts(params)
    let setNow: (iso: string) => void

    beforeEach(async () => {
      await params.reset()
      let now = T0
      setNow = (iso) => (now = iso)
      plane = new ControlPlane({ store: params.makeStore(), clock: () => now })
    })

    afterEach(() => hosts.releaseAll())

    const claimable = (limit = 100): Promise<string[]> => hosts.claimedByFreshHost({ plane, limit })

    const markPrepared = async (args: { sessionId: string; threadId: string }): Promise<void> => {
      const { epoch } = await plane.grant({ sessionId: args.sessionId, hostId: HOLDER_HOST })
      const head = await plane.head({ threadId: args.threadId })
      const outcome = await plane.append({
        threadId: args.threadId,
        epoch,
        events: mint({
          bodies: [{ type: 'workspace-prepared' }],
          epoch,
          from: head,
          threadId: args.threadId,
        }),
      })
      if (!outcome.ok) throw new Error(JSON.stringify(outcome.refusal))
      await plane.revoke({ sessionId: args.sessionId, wantsHolder: false })
    }

    const seedSession = async (seed: {
      sessionId: string
      offsetMs: number
      prepared?: boolean
    }): Promise<void> => {
      setNow(after({ iso: T0, offsetMs: seed.offsetMs }))
      const threadId = `t-${seed.sessionId}`
      await plane.createSession(
        createSessionParams({ sessionId: seed.sessionId, mainThreadId: threadId }),
      )
      if (seed.prepared === false) return
      await markPrepared({ sessionId: seed.sessionId, threadId })
    }

    it('creates a session and its main thread in one transaction', async () => {
      await plane.createSession({
        sessionId: SESSION,
        userId: USER,
        projectId: PROJECT,
        title: 'First session',
        mainThreadId: THREAD,
      })
      expect(await plane.readSession({ sessionId: SESSION })).toEqual({
        sessionId: SESSION,
        userId: USER,
        projectId: PROJECT,
        title: 'First session',
        mainThreadId: THREAD,
        createdAt: T0,
        archivedAt: null,
        modelRef: null,
        modelEffort: null,
        modelFast: null,
      })
      expect(await plane.head({ threadId: THREAD })).toEqual({ seq: 0, hash: expect.any(String) })
      expect(await plane.readSession({ sessionId: 'unknown' })).toBeUndefined()
    })

    it('remembers the model the session was created with', async () => {
      await plane.createSession({
        sessionId: SESSION,
        userId: USER,
        projectId: PROJECT,
        mainThreadId: THREAD,
        modelRef: 'openai/gpt-5',
        modelEffort: 'high',
        modelFast: true,
      })
      const row = await plane.readSession({ sessionId: SESSION })
      expect(row?.modelRef).toBe('openai/gpt-5')
      expect(row?.modelEffort).toBe('high')
      expect(row?.modelFast).toBe(true)
    })

    it('lists sessions newest first per user with the limit clamped', async () => {
      for (const [index, sessionId] of ['s-a', 's-b', 's-c'].entries()) {
        setNow(after({ iso: T0, offsetMs: index * 1000 }))
        await plane.createSession(
          createSessionParams({ sessionId, mainThreadId: `t-${sessionId}` }),
        )
      }
      setNow(T0)
      await plane.createSession({
        sessionId: 'other-user',
        userId: 'user-2',
        projectId: PROJECT,
        mainThreadId: 't-other',
      })
      setNow(after({ iso: T0, offsetMs: 5000 }))
      await plane.createSession({
        sessionId: 'other-project',
        userId: USER,
        projectId: 'project-2',
        mainThreadId: 't-other-project',
      })
      const listed = await plane.listSessions({ userId: USER, limit: 10 })
      expect(listed.map((row) => row.sessionId)).toEqual(['other-project', 's-c', 's-b', 's-a'])
      const filtered = await plane.listSessions({ userId: USER, projectId: PROJECT, limit: 2 })
      expect(filtered.map((row) => row.sessionId)).toEqual(['s-c', 's-b'])
      expect(filtered[0]?.title).toBeNull()
    })

    it('digests each session with its last event time and first posted message', async () => {
      await seedSession({ sessionId: 's-a', offsetMs: 0, prepared: false })
      await seedSession({ sessionId: 's-b', offsetMs: 1000 })
      await plane.post({ sessionId: 's-a', kind: 'message', payload: '{"text":"first"}' })
      await plane.post({ sessionId: 's-a', kind: 'message', payload: '{"text":"second"}' })
      await plane.post({ sessionId: 's-a', kind: 'stop', payload: '{}' })
      const digests = await plane.listSessionDigests({ userId: USER, limit: 10 })
      expect(digests.map((row) => row.sessionId)).toEqual(['s-b', 's-a'])
      expect(digests[0]?.lastEventAt).toBe(T0)
      expect(digests[0]?.firstMessageText).toBeNull()
      expect(digests[1]?.lastEventAt).toBeNull()
      expect(digests[1]?.firstMessageText).toBe('first')
      const scoped = await plane.listSessionDigests({ userId: USER, projectId: 'nope', limit: 10 })
      expect(scoped).toEqual([])
    })

    it('archives and unarchives a session and digests carry the stamp', async () => {
      await seedSession({ sessionId: 's-a', offsetMs: 0 })
      await seedSession({ sessionId: 's-b', offsetMs: 1000 })
      const stamp = after({ iso: T0, offsetMs: 5000 })
      await plane.setSessionArchived({ sessionId: 's-a', archivedAt: stamp })
      expect((await plane.readSession({ sessionId: 's-a' }))?.archivedAt).toBe(stamp)
      const archived = await plane.listSessionDigests({ userId: USER, limit: 10 })
      expect(archived.map((row) => [row.sessionId, row.archivedAt])).toEqual([
        ['s-b', null],
        ['s-a', stamp],
      ])
      await plane.setSessionArchived({ sessionId: 's-a', archivedAt: null })
      const restored = await plane.listSessionDigests({ userId: USER, limit: 10 })
      expect(restored.map((row) => row.archivedAt)).toEqual([null, null])
    })

    it('refuses to archive an unknown session', async () => {
      await expect(plane.setSessionArchived({ sessionId: 'nope', archivedAt: T0 })).rejects.toThrow(
        'unknown session nope',
      )
    })

    it('clamps the session list to 100', async () => {
      for (let index = 0; index < 101; index += 1) {
        setNow(after({ iso: T0, offsetMs: index }))
        await plane.createSession(
          createSessionParams({
            sessionId: `s-${String(index).padStart(3, '0')}`,
            mainThreadId: `t-s-${index}`,
          }),
        )
      }
      const listed = await plane.listSessions({ userId: USER, limit: 500 })
      expect(listed.length).toBe(100)
      expect(listed[0]?.sessionId).toBe('s-100')
      expect(listed[99]?.sessionId).toBe('s-001')
    })

    it('claims only sessions that need a holder, in creation order, limited', async () => {
      await seedSession({ sessionId: 'idle-released', offsetMs: 1000 })
      await plane.grant({ sessionId: 'idle-released', hostId: HOLDER_HOST })
      await plane.revoke({ sessionId: 'idle-released', wantsHolder: false })

      await seedSession({ sessionId: 'never-leased-posted', offsetMs: 2000 })
      await plane.post({ sessionId: 'never-leased-posted', kind: 'user', payload: '"hi"' })

      await seedSession({ sessionId: 'absent-holder', offsetMs: 3000 })
      await plane.grant({ sessionId: 'absent-holder', hostId: HOLDER_HOST })

      await seedSession({ sessionId: 'live-holder', offsetMs: 4000 })
      const liveHost = await params.nextHostId()
      const releaseLive = await params.holdPresence(liveHost)
      await plane.grant({ sessionId: 'live-holder', hostId: liveHost })

      await seedSession({ sessionId: 'drain-revoked', offsetMs: 5000 })
      await plane.grant({ sessionId: 'drain-revoked', hostId: HOLDER_HOST })
      await plane.revoke({ sessionId: 'drain-revoked', wantsHolder: true })

      await seedSession({ sessionId: 'granted-again', offsetMs: 6000 })
      await plane.revoke({ sessionId: 'granted-again', wantsHolder: true })
      await plane.grant({ sessionId: 'granted-again', hostId: liveHost })

      expect(await claimable(2)).toEqual(['never-leased-posted', 'absent-holder'])
      expect(await claimable(5000)).toEqual(['drain-revoked'])
      expect(await claimable()).toEqual([])
      await releaseLive()
    })

    it('claims a held session whose host is absent, not one whose host is present', async () => {
      await seedSession({ sessionId: SESSION, offsetMs: 0 })
      const hostId = await params.nextHostId()
      const release = await params.holdPresence(hostId)
      await plane.grant({ sessionId: SESSION, hostId })
      expect(await claimable()).toEqual([])
      await release()
      expect(await claimable()).toEqual([SESSION])
    })

    it('claims a never-leased session with an empty inbox until its workspace is prepared', async () => {
      await seedSession({ sessionId: SESSION, offsetMs: 0, prepared: false })
      expect(await claimable()).toEqual([SESSION])
    })

    it('does not claim a prepared never-leased session with an empty inbox', async () => {
      await seedSession({ sessionId: SESSION, offsetMs: 0 })
      expect(await claimable()).toEqual([])
    })

    it('claims an unprepared session among prepared ones, in creation order', async () => {
      await seedSession({ sessionId: 'prepared-old', offsetMs: 0 })
      await seedSession({ sessionId: 'fresh-a', offsetMs: 1000, prepared: false })
      await seedSession({ sessionId: 'prepared-new', offsetMs: 2000 })
      await seedSession({ sessionId: 'fresh-b', offsetMs: 3000, prepared: false })
      expect(await claimable()).toEqual(['fresh-a', 'fresh-b'])
    })

    it('stops claiming a session once it has turns, even without a prepare event', async () => {
      await seedSession({ sessionId: SESSION, offsetMs: 0, prepared: false })
      const { epoch } = await plane.grant({ sessionId: SESSION, hostId: HOLDER_HOST })
      const outcome = await plane.append({
        threadId: `t-${SESSION}`,
        epoch,
        events: mint({
          bodies: [{ type: 'user-said', text: 'hi' }],
          epoch,
          threadId: `t-${SESSION}`,
        }),
      })
      if (!outcome.ok) throw new Error(JSON.stringify(outcome.refusal))
      await plane.revoke({ sessionId: SESSION, wantsHolder: false })
      expect(await claimable()).toEqual([])
    })

    it('does not claim a session whose only inbox entry is consumed', async () => {
      setNow(T0)
      await plane.createSession(createSessionParams({ sessionId: SESSION, mainThreadId: THREAD }))
      const { epoch } = await plane.grant({ sessionId: SESSION, hostId: HOLDER_HOST })
      const { inboxId } = await plane.post({ sessionId: SESSION, kind: 'user', payload: '"a"' })
      const outcome = await plane.append({
        threadId: THREAD,
        epoch,
        events: mint({
          bodies: [{ type: 'workspace-prepared' }, { type: 'input-consumed', inboxId }],
          epoch,
        }),
      })
      if (!outcome.ok) throw new Error(JSON.stringify(outcome.refusal))
      await plane.revoke({ sessionId: SESSION, wantsHolder: false })
      expect(await claimable()).toEqual([])
    })

    it('does not claim a failed session whose only pending message is covered, until a newer one arrives', async () => {
      setNow(T0)
      await plane.createSession(createSessionParams({ sessionId: SESSION, mainThreadId: THREAD }))
      await plane.post({ sessionId: SESSION, kind: 'message', payload: '"a"' })
      const { epoch } = await plane.grant({ sessionId: SESSION, hostId: HOLDER_HOST })
      const outcome = await plane.append({
        threadId: THREAD,
        epoch,
        events: mint({
          bodies: [{ type: 'workspace-prepare-failed', reason: 'clone failed', inboxHead: 1 }],
          epoch,
        }),
      })
      if (!outcome.ok) throw new Error(JSON.stringify(outcome.refusal))
      await plane.revoke({ sessionId: SESSION, wantsHolder: false })
      expect(await claimable()).toEqual([])
      await plane.post({ sessionId: SESSION, kind: 'message', payload: '"b"' })
      expect(await claimable()).toEqual([SESSION])
    })

    it('claims a session posted to after an idle release, but not before', async () => {
      await seedSession({ sessionId: SESSION, offsetMs: 0 })
      await plane.grant({ sessionId: SESSION, hostId: HOLDER_HOST })
      await plane.revoke({ sessionId: SESSION, wantsHolder: false })
      expect(await claimable()).toEqual([])
      await plane.post({ sessionId: SESSION, kind: 'user', payload: '"later"' })
      expect(await claimable()).toEqual([SESSION])
    })
  })
}
