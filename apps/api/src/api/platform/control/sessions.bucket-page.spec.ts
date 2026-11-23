import { chainEvents, toRunId, toThreadId } from '@dltech/atlas-core'
import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { ESessionPageBucket } from '@dltech/atlas-protocol'
import { BadRequestException } from '@nestjs/common'
import { describe, expect, it } from 'bun:test'

import { bucketPageSessions } from './session-bucket-page'

const USER = 'user-a'
const T0 = '2026-11-20T12:00:00.000Z'
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const QUERY_MS = Date.parse(T0) + 5 * DAY_MS
const HOST = 9001

const at = (offsetMs: number): string => new Date(Date.parse(T0) + offsetMs).toISOString()

describe('sessions.bucketPage', () => {
  const testDb = useTestDatabase()

  const setup = () => {
    let now = T0
    const plane = new ControlPlane({
      store: new PostgresControlStore(testDb().db),
      clock: () => now,
    })
    const seed = async (seedArgs: {
      sessionId: string
      offsetMs: number
      title?: string | undefined
    }): Promise<string> => {
      now = at(seedArgs.offsetMs)
      const mainThreadId = `t-${seedArgs.sessionId}`
      await plane.createSession({
        sessionId: seedArgs.sessionId,
        userId: USER,
        projectId: null,
        mainThreadId,
        sandboxProvider: 'vercel',
        sandboxInstanceId: null,
        ...(seedArgs.title === undefined ? {} : { title: seedArgs.title }),
      })
      return mainThreadId
    }
    return { plane, seed }
  }

  const page = (args: {
    plane: ControlPlane
    bucket: ESessionPageBucket
    limit?: number
    cursor?: string
    search?: string
  }) =>
    bucketPageSessions({
      plane: args.plane,
      userId: USER,
      bucket: args.bucket,
      now: QUERY_MS,
      ...(args.limit === undefined ? {} : { limit: args.limit }),
      ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
      ...(args.search === undefined ? {} : { search: args.search }),
    })

  it('pages the archived bucket newest first and carries the counts of both buckets', async () => {
    const { plane, seed } = setup()
    for (const [index, sessionId] of ['s-a', 's-b', 's-c'].entries()) {
      await seed({ sessionId, offsetMs: index * 1000 })
      await plane.setSessionArchived({ sessionId, archivedAt: at(index * 1000) })
    }
    await seed({ sessionId: 's-live', offsetMs: 5 * DAY_MS - HOUR_MS })

    const first = await page({ plane, bucket: ESessionPageBucket.Archived, limit: 2 })
    expect(first.sessions.map((session) => session.sessionId)).toEqual(['s-c', 's-b'])
    expect(first.counts).toEqual({ inactive: 0, archived: 3 })
    if (first.next === undefined) throw new Error('expected a next cursor')
    const second = await page({
      plane,
      bucket: ESessionPageBucket.Archived,
      limit: 2,
      cursor: first.next,
    })
    expect(second.sessions.map((session) => session.sessionId)).toEqual(['s-a'])
    expect(second.next).toBeUndefined()
  })

  it('keeps a session whose last event is newer than the cutoff out of the inactive bucket', async () => {
    const { plane, seed } = setup()
    await seed({ sessionId: 's-stale', offsetMs: 0 })
    const busyThread = await seed({ sessionId: 's-busy', offsetMs: 0 })
    const lease = await plane.grant({ sessionId: 's-busy', hostId: HOST })
    const appended = await plane.append({
      threadId: busyThread,
      epoch: lease.epoch,
      events: chainEvents({
        threadId: toThreadId(busyThread),
        runId: toRunId('run-1'),
        epoch: lease.epoch,
        at: at(4 * DAY_MS),
        bodies: [{ type: 'user-said', text: 'still here' }],
        from: await plane.head({ threadId: busyThread }),
      }),
    })
    expect(appended.ok).toBe(true)
    await seed({ sessionId: 's-fresh', offsetMs: 5 * DAY_MS - HOUR_MS })

    const inactive = await page({ plane, bucket: ESessionPageBucket.Inactive })
    expect(inactive.sessions.map((session) => session.sessionId)).toEqual(['s-stale'])
    expect(inactive.counts).toEqual({ inactive: 1, archived: 0 })
  })

  it('searches the title and the first posted message and scopes the counts by it', async () => {
    const { plane, seed } = setup()
    await seed({ sessionId: 's-titled', offsetMs: 0, title: 'Quarterly report' })
    await seed({ sessionId: 's-spoken', offsetMs: 1000 })
    await plane.post({
      sessionId: 's-spoken',
      kind: 'message',
      payload: JSON.stringify({ text: 'a needle in the haystack', via: 'operator' }),
    })

    const byMessage = await page({
      plane,
      bucket: ESessionPageBucket.Inactive,
      search: 'needle',
    })
    expect(byMessage.sessions.map((session) => session.sessionId)).toEqual(['s-spoken'])
    expect(byMessage.counts).toEqual({ inactive: 1, archived: 0 })
    const byTitle = await page({
      plane,
      bucket: ESessionPageBucket.Inactive,
      search: 'quarterly',
    })
    expect(byTitle.sessions.map((session) => session.title)).toEqual(['Quarterly report'])
  })

  it('refuses a cursor it cannot read', async () => {
    const { plane } = setup()
    await expect(
      page({ plane, bucket: ESessionPageBucket.Archived, cursor: 'no-separator' }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })
})
