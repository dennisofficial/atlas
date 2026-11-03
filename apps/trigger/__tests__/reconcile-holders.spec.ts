import { describe, expect, it, mock } from 'bun:test'

import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import { WAKE_CHANNEL } from '@dltech/atlas-protocol'

import { reconcileHolders, type ReconcilePublish } from '../src/reconcile/reconcile-holders'

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

    const publish = mock<ReconcilePublish>(async () => {})
    const result = await reconcileHolders({ plane, publish, limit: 100 })

    expect(result).toEqual({ woken: 1, failed: 0 })
    expect(publish).toHaveBeenCalledWith({
      channel: WAKE_CHANNEL,
      message: { sessionId: SESSION },
    })
  })

  it('does not wake a session with a live holder', async () => {
    const { plane } = makePlane()
    await seedSession(plane)
    await plane.grant({ sessionId: SESSION, holderId: HOLDER, ttlMs: 60_000 })

    const publish = mock<ReconcilePublish>(async () => {})
    const result = await reconcileHolders({ plane, publish, limit: 100 })

    expect(result).toEqual({ woken: 0, failed: 0 })
    expect(publish).not.toHaveBeenCalled()
  })

  it('wakes a session whose holder lease expired', async () => {
    const { plane, setNow } = makePlane()
    await seedSession(plane)
    await plane.grant({ sessionId: SESSION, holderId: HOLDER, ttlMs: 1_000 })
    setNow(after({ iso: T0, offsetMs: 1_000 }))

    const publish = mock<ReconcilePublish>(async () => {})
    const result = await reconcileHolders({ plane, publish, limit: 100 })

    expect(result).toEqual({ woken: 1, failed: 0 })
    expect(publish).toHaveBeenCalledWith({
      channel: WAKE_CHANNEL,
      message: { sessionId: SESSION },
    })
  })

  it('counts publish failures and keeps waking the rest', async () => {
    const { plane } = makePlane()
    for (const sessionId of ['s-a', 's-b', 's-c']) {
      await plane.createSession({
        sessionId,
        userId: 'user-1',
        projectId: 'project-1',
        mainThreadId: `t-${sessionId}`,
      })
      await plane.post({ sessionId, kind: 'user', payload: '"hi"' })
    }

    const failing = new Set(['s-b'])
    const publish = mock<ReconcilePublish>(async ({ message }) => {
      if (failing.has(message.sessionId)) throw new Error('redis down')
    })
    const result = await reconcileHolders({ plane, publish, limit: 100 })

    expect(result).toEqual({ woken: 2, failed: 1 })
    expect(publish).toHaveBeenCalledTimes(3)
  })

  it('passes the limit through to sessionsNeedingHolder', async () => {
    const sessionsNeedingHolder = mock(async (_params: { limit: number }) => [] as string[])
    const publish = mock<ReconcilePublish>(async () => {})

    const result = await reconcileHolders({ plane: { sessionsNeedingHolder }, publish, limit: 7 })

    expect(result).toEqual({ woken: 0, failed: 0 })
    expect(sessionsNeedingHolder).toHaveBeenCalledWith({ limit: 7 })
  })
})
