import { beforeEach, describe, expect, it } from 'bun:test'

import { ControlPlane } from '../../control-plane'
import { createSessionParams, HOLDER, mint, PROJECT, SESSION, T0, THREAD, USER } from './support'
import type { ConformanceParams } from './conformance'

const after = (params: { iso: string; offsetMs: number }): string =>
  new Date(Date.parse(params.iso) + params.offsetMs).toISOString()

export function describeControlPlaneSessions(params: ConformanceParams): void {
  describe(`ControlPlane sessions (${params.name})`, () => {
    let plane: ControlPlane
    let setNow: (iso: string) => void

    beforeEach(async () => {
      await params.reset()
      let now = T0
      setNow = (iso) => (now = iso)
      plane = new ControlPlane({ store: params.makeStore(), clock: () => now })
    })

    const seedSession = async (seed: { sessionId: string; offsetMs: number }): Promise<void> => {
      setNow(after({ iso: T0, offsetMs: seed.offsetMs }))
      await plane.createSession(
        createSessionParams({ sessionId: seed.sessionId, mainThreadId: `t-${seed.sessionId}` }),
      )
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
      })
      expect(await plane.head({ threadId: THREAD })).toEqual({
        seq: 0,
        hash: expect.any(String),
      })
      expect(await plane.readSession({ sessionId: 'unknown' })).toBeUndefined()
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

    it('returns only sessions that need a holder, in creation order, limited', async () => {
      await seedSession({ sessionId: 'idle-released', offsetMs: 1000 })
      await plane.grant({ sessionId: 'idle-released', holderId: HOLDER, ttlMs: 60_000 })
      await plane.revoke({ sessionId: 'idle-released', wantsHolder: false })

      await seedSession({ sessionId: 'never-leased-posted', offsetMs: 2000 })
      await plane.post({ sessionId: 'never-leased-posted', kind: 'user', payload: '"hi"' })

      await seedSession({ sessionId: 'expired-holder', offsetMs: 3000 })
      await plane.grant({ sessionId: 'expired-holder', holderId: HOLDER, ttlMs: 1_000 })

      await seedSession({ sessionId: 'live-holder', offsetMs: 4000 })
      await plane.grant({ sessionId: 'live-holder', holderId: HOLDER, ttlMs: 60_000 })

      await seedSession({ sessionId: 'drain-revoked', offsetMs: 5000 })
      await plane.grant({ sessionId: 'drain-revoked', holderId: HOLDER, ttlMs: 60_000 })
      await plane.revoke({ sessionId: 'drain-revoked', wantsHolder: true })

      await seedSession({ sessionId: 'granted-again', offsetMs: 6000 })
      await plane.revoke({ sessionId: 'granted-again', wantsHolder: true })
      await plane.grant({ sessionId: 'granted-again', holderId: HOLDER, ttlMs: 60_000 })

      const needing = await plane.sessionsNeedingHolder({ limit: 100 })
      expect(needing).toEqual(['never-leased-posted', 'expired-holder', 'drain-revoked'])
      expect(await plane.sessionsNeedingHolder({ limit: 2 })).toEqual([
        'never-leased-posted',
        'expired-holder',
      ])
      expect(await plane.sessionsNeedingHolder({ limit: 5000 })).toEqual(needing)
    })

    it('needs a holder at exactly renewedAt + ttlMs, but not one ms before', async () => {
      await seedSession({ sessionId: SESSION, offsetMs: 0 })
      await plane.grant({ sessionId: SESSION, holderId: HOLDER, ttlMs: 60_000 })
      setNow(after({ iso: T0, offsetMs: 60_000 }))
      expect(await plane.sessionsNeedingHolder({ limit: 10 })).toEqual([SESSION])
      setNow(after({ iso: T0, offsetMs: 59_999 }))
      expect(await plane.sessionsNeedingHolder({ limit: 10 })).toEqual([])
    })

    it('excludes a never-leased session with an empty inbox', async () => {
      await seedSession({ sessionId: SESSION, offsetMs: 0 })
      expect(await plane.sessionsNeedingHolder({ limit: 10 })).toEqual([])
    })

    it('excludes a session whose only inbox entry is consumed', async () => {
      setNow(T0)
      await plane.createSession(createSessionParams({ sessionId: SESSION, mainThreadId: THREAD }))
      const { epoch } = await plane.grant({ sessionId: SESSION, holderId: HOLDER, ttlMs: 60_000 })
      const { inboxId } = await plane.post({ sessionId: SESSION, kind: 'user', payload: '"a"' })
      const outcome = await plane.append({
        threadId: THREAD,
        epoch,
        events: mint({ bodies: [{ type: 'input-consumed', inboxId }], epoch }),
      })
      if (!outcome.ok) throw new Error(JSON.stringify(outcome.refusal))
      await plane.revoke({ sessionId: SESSION, wantsHolder: false })
      expect(await plane.sessionsNeedingHolder({ limit: 10 })).toEqual([])
    })

    it('returns a session posted to after an idle release, but not before', async () => {
      await seedSession({ sessionId: SESSION, offsetMs: 0 })
      await plane.grant({ sessionId: SESSION, holderId: HOLDER, ttlMs: 60_000 })
      await plane.revoke({ sessionId: SESSION, wantsHolder: false })
      expect(await plane.sessionsNeedingHolder({ limit: 10 })).toEqual([])
      await plane.post({ sessionId: SESSION, kind: 'user', payload: '"later"' })
      expect(await plane.sessionsNeedingHolder({ limit: 10 })).toEqual([SESSION])
    })
  })
}
