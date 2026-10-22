import { POD_EVENT_CONFLICT_CODE, type PodEvent } from '@dltech/atlas-wire'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { eventsOf, seedEventRow, seedThreadRow, seedUsers } from '../../../../test/session-seed'
import { applyPodEvents, truncatePodEvents } from './pod-events'

const AT = '2026-10-22T10:00:00.000Z'
const eventAt = (seq: number, extra: Partial<PodEvent> = {}): PodEvent => ({
  seq,
  runId: 'run_pod',
  depth: 0,
  at: AT,
  type: 'assistant-said',
  body: JSON.stringify({ type: 'assistant-said', seq }),
  ...extra,
})

const head = async () => (await db.orm.public.Thread.first({ id: 'thr-1' }))?.head

const conflictOf = async (promise: Promise<unknown>) => {
  const failure = await promise.then(
    () => undefined,
    (error: unknown) => error as { status: number; response: unknown },
  )
  return failure
}

describe('applyPodEvents', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedUsers('user-a')
    await seedThreadRow({ id: 'thr-1', userId: 'user-a', head: 1 })
    await seedEventRow({ threadId: 'thr-1', seq: 1, body: '{"type":"user-said"}' })
  })

  it('appends contiguous events with the pod seq and time, owned by the thread owner', async () => {
    const reply = await applyPodEvents({
      threadId: 'thr-1',
      events: [
        eventAt(2, {
          parentRunId: 'run_up',
          depth: 1,
          contextSlot: 's',
          contextKey: 'k',
          contextDigest: 'd',
        }),
        eventAt(3),
      ],
    })

    expect(reply).toEqual({ head: 3 })
    expect(await head()).toBe(3)
    const rows = await eventsOf('thr-1')
    expect(rows.map((row) => row.seq)).toEqual([1, 2, 3])
    expect(rows[1]).toMatchObject({
      runId: 'run_pod',
      parentRunId: 'run_up',
      depth: 1,
      type: 'assistant-said',
      contextSlot: 's',
      contextKey: 'k',
      contextDigest: 'd',
      userId: 'user-a',
    })
    expect(rows[1]?.at.toISOString()).toBe(AT)
  })

  it('treats an identical re-post as a no-op', async () => {
    await applyPodEvents({ threadId: 'thr-1', events: [eventAt(2)] })

    const reply = await applyPodEvents({ threadId: 'thr-1', events: [eventAt(2), eventAt(3)] })

    expect(reply).toEqual({ head: 3 })
    expect(await eventsOf('thr-1')).toHaveLength(3)
  })

  it('answers 409 with the seq when a row exists with different content, writing nothing', async () => {
    const failure = await conflictOf(
      applyPodEvents({
        threadId: 'thr-1',
        events: [eventAt(2), eventAt(1, { body: '{"type":"other"}' })],
      }),
    )

    expect(failure?.status).toBe(409)
    expect(failure?.response).toMatchObject({ code: POD_EVENT_CONFLICT_CODE, seq: 1 })
    expect(await eventsOf('thr-1')).toHaveLength(1)
    expect(await head()).toBe(1)
  })

  it('answers 409 for a gap past head+1, writing nothing', async () => {
    const failure = await conflictOf(
      applyPodEvents({ threadId: 'thr-1', events: [eventAt(2), eventAt(4)] }),
    )

    expect(failure?.status).toBe(409)
    expect(failure?.response).toMatchObject({ code: POD_EVENT_CONFLICT_CODE, seq: 4 })
    expect(await eventsOf('thr-1')).toHaveLength(1)
    expect(await head()).toBe(1)
  })

  it('never lowers the head', async () => {
    await db.orm.public.Thread.where({ id: 'thr-1' }).update({ head: 5 })

    const reply = await applyPodEvents({
      threadId: 'thr-1',
      events: [
        eventAt(1, { body: '{"type":"user-said"}', runId: 'run_1', depth: 0, type: 'user-said' }),
      ],
    })

    expect(reply).toEqual({ head: 5 })
  })
})

describe('truncatePodEvents', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedUsers('user-a')
    await seedThreadRow({ id: 'thr-1', userId: 'user-a', head: 3 })
    for (const seq of [1, 2, 3]) await seedEventRow({ threadId: 'thr-1', seq })
  })

  it('deletes events past toSeq and sets the head to it', async () => {
    expect(await truncatePodEvents({ threadId: 'thr-1', toSeq: 1 })).toEqual({ head: 1 })

    expect((await eventsOf('thr-1')).map((row) => row.seq)).toEqual([1])
    expect(await head()).toBe(1)
  })

  it('never raises the head', async () => {
    expect(await truncatePodEvents({ threadId: 'thr-1', toSeq: 9 })).toEqual({ head: 3 })

    expect(await eventsOf('thr-1')).toHaveLength(3)
    expect(await head()).toBe(3)
  })
})
