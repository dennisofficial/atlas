import { beforeEach, describe, expect, it } from 'bun:test'
import { isLive } from '@dltech/atlas-core'

import { ControlPlane } from '../../control-plane'
import { InMemoryControlStore } from '../memory/memory-store'
import { PostgresControlStore } from '../../postgres/postgres-store'
import { createSessionParams, HOLDER, PROJECT, SESSION, T0, THREAD, USER } from './support'
import type { ConformanceParams } from './conformance'

const second = (iso: string, offsetSeconds: number): string =>
  new Date(Date.parse(iso) + offsetSeconds * 1000).toISOString()

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
        setNow(second(T0, index))
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
      setNow(second(T0, 5))
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

    it('returns only sessions that need a holder, in creation order, limited', async () => {
      const make = async (sessionId: string, offsetSeconds: number): Promise<void> => {
        setNow(second(T0, offsetSeconds))
        await plane.createSession(
          createSessionParams({ sessionId, mainThreadId: `t-${sessionId}` }),
        )
      }

      await make('idle-released', 1)
      await plane.grant({ sessionId: 'idle-released', holderId: HOLDER, ttlMs: 60_000 })
      await plane.revoke({ sessionId: 'idle-released', wantsHolder: false })

      await make('never-leased-posted', 2)
      await plane.post({ sessionId: 'never-leased-posted', kind: 'user', payload: '"hi"' })

      await make('expired-holder', 3)
      await plane.grant({ sessionId: 'expired-holder', holderId: HOLDER, ttlMs: 1_000 })

      await make('live-holder', 4)
      await plane.grant({ sessionId: 'live-holder', holderId: HOLDER, ttlMs: 60_000 })

      await make('drain-revoked', 5)
      await plane.grant({ sessionId: 'drain-revoked', holderId: HOLDER, ttlMs: 60_000 })
      await plane.revoke({ sessionId: 'drain-revoked', wantsHolder: true })

      await make('granted-again', 6)
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

    it('uses the store clock when no clock is injected', async () => {
      const store = params.makeStore()
      if (store instanceof InMemoryControlStore) return
      if (!(store instanceof PostgresControlStore)) throw new Error('unknown store')
      const dbPlane = new ControlPlane({ store })
      await dbPlane.createSession({
        sessionId: 'db-clock',
        userId: USER,
        projectId: PROJECT,
        mainThreadId: 't-db-clock',
      })
      const first = await dbPlane.grant({ sessionId: 'db-clock', holderId: 'pod-1', ttlMs: 60_000 })
      const second = await dbPlane.grant({
        sessionId: 'db-clock',
        holderId: 'pod-2',
        ttlMs: 60_000,
      })
      expect(second.renewedAt >= first.renewedAt).toBe(true)
      const current = await dbPlane.currentLease({ sessionId: 'db-clock' })
      expect(isLive({ lease: current.lease, now: current.lease.renewedAt })).toBe(true)
      expect(current.live).toBe(true)
    })
  })
}
