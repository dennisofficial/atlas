import { describe, expect, it, mock } from 'bun:test'

import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'

import { reconcileHolders } from '../src/reconcile/reconcile-holders'

const SESSION = 'session-1'
const THREAD = 'thread-1'
const HOLDER = 'pod-a'
const T0 = '2026-11-02T12:00:00.000Z'

const after = (params: { iso: string; offsetMs: number }): string =>
  new Date(Date.parse(params.iso) + params.offsetMs).toISOString()

const makePlane = (): { plane: ControlPlane; setNow: (iso: string) => void } => {
  let now = T0
  const plane = new ControlPlane({ store: new InMemoryControlStore(), clock: () => now })
  return { plane, setNow: (iso) => (now = iso) }
}

const seedSession = async (plane: ControlPlane): Promise<void> => {
  await plane.createSession({
    sessionId: SESSION,
    userId: 'user-1',
    projectId: 'project-1',
    mainThreadId: THREAD,
  })
}

describe('reconcileHolders', () => {
  it('wakes a session with an unconsumed post and no lease', async () => {
    const { plane } = makePlane()
    await seedSession(plane)
    await plane.post({ sessionId: SESSION, kind: 'user', payload: '"hi"' })

    const result = await reconcileHolders({ plane, limit: 100 })

    expect(result).toEqual({ woken: 1, failed: 0 })
    const claimed = await plane.claim({ sessionId: SESSION, holderId: HOLDER, ttlMs: 60_000 })
    expect(claimed.ok).toBe(true)
  })

  it('does not wake a session with a live holder', async () => {
    const { plane } = makePlane()
    await seedSession(plane)
    await plane.grant({ sessionId: SESSION, holderId: HOLDER, ttlMs: 60_000 })

    const wake = mock(async (_params: { sessionIds: readonly string[] }) => {})
    const result = await reconcileHolders({
      plane: { sessionsNeedingHolder: () => plane.sessionsNeedingHolder({ limit: 100 }), wake },
      limit: 100,
    })

    expect(result).toEqual({ woken: 0, failed: 0 })
    expect(wake).not.toHaveBeenCalled()
  })

  it('wakes a session whose holder lease expired', async () => {
    const { plane, setNow } = makePlane()
    await seedSession(plane)
    await plane.grant({ sessionId: SESSION, holderId: HOLDER, ttlMs: 1_000 })
    setNow(after({ iso: T0, offsetMs: 1_000 }))

    const wake = mock(async (_params: { sessionIds: readonly string[] }) => {})
    const result = await reconcileHolders({
      plane: { sessionsNeedingHolder: () => plane.sessionsNeedingHolder({ limit: 100 }), wake },
      limit: 100,
    })

    expect(result).toEqual({ woken: 1, failed: 0 })
    expect(wake).toHaveBeenCalledWith({ sessionIds: [SESSION] })
  })

  it('counts a failed wake against every listed session', async () => {
    const sessionIds = ['s-a', 's-b', 's-c']
    const wake = mock(async (_params: { sessionIds: readonly string[] }) => {
      throw new Error('database down')
    })
    const result = await reconcileHolders({
      plane: { sessionsNeedingHolder: async () => sessionIds, wake },
      limit: 100,
    })

    expect(result).toEqual({ woken: 0, failed: 3 })
  })

  it('passes the limit through to sessionsNeedingHolder', async () => {
    const sessionsNeedingHolder = mock(async (_params: { limit: number }) => [] as string[])
    const wake = mock(async (_params: { sessionIds: readonly string[] }) => {})

    const result = await reconcileHolders({ plane: { sessionsNeedingHolder, wake }, limit: 7 })

    expect(result).toEqual({ woken: 0, failed: 0 })
    expect(sessionsNeedingHolder).toHaveBeenCalledWith({ limit: 7 })
  })
})
