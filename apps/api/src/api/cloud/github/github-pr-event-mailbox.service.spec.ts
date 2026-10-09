import { beforeEach, describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import type { PrismaClient } from '../../../generated/prisma/client'

vi.mock('../../../db', async () => {
  const { fakeGithubDb } = await import('../../../../test/fake-github-db.js')
  return { db: fakeGithubDb().db as unknown as PrismaClient }
})

import { fakeGithubDb } from '../../../../test/fake-github-db'
import { DrainStateService } from '../../platform/health/drain-state.service'
import { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import { EPrEventKind } from './github-realtime.types'
import type { GithubSandboxWakeService } from './github-sandbox-wake.service'

const fake = fakeGithubDb()

function serviceWith(): {
  mailbox: GithubPrEventMailboxService
  fanout: GithubPrFanoutService
} {
  const fanout = new GithubPrFanoutService(new DrainStateService())
  const wake = { notifyEvent: () => undefined } as unknown as GithubSandboxWakeService
  return { mailbox: new GithubPrEventMailboxService(fanout, wake), fanout }
}

describe('GithubPrEventMailboxService', () => {
  beforeEach(() => fake.reset())

  it('records one row per subscriber and pushes a live frame to each', async () => {
    const { mailbox, fanout } = serviceWith()
    const receivedA: unknown[] = []
    const receivedB: unknown[] = []
    fanout.openStream({
      userId: 'usr-a',
      handler: () => undefined,
      eventHandler: (event) => receivedA.push(event),
    })
    fanout.openStream({
      userId: 'usr-b',
      handler: () => undefined,
      eventHandler: (event) => receivedB.push(event),
    })

    await mailbox.record({
      userIds: ['usr-a', 'usr-b'],
      repoFullName: 'compai/app',
      prNumber: 42,
      kind: EPrEventKind.Comment,
      payload: { url: 'https://github.com/compai/app/pull/42#issuecomment-1', authorLogin: 'dennis', body: 'hi' },
    })

    expect(fake.prEvents).toHaveLength(2)
    expect(fake.prEvents.every((row) => row.deliveredAt === null)).toBe(true)
    expect(receivedA).toHaveLength(1)
    expect(receivedB).toHaveLength(1)
    expect(receivedA[0]).toMatchObject({ kind: 'comment', repoFullName: 'compai/app', prNumber: 42 })
  })

  it('records without pushing when no stream is open — the row waits for replay', async () => {
    const { mailbox } = serviceWith()

    await mailbox.record({
      userIds: ['usr-a'],
      repoFullName: 'compai/app',
      prNumber: 42,
      kind: EPrEventKind.Verdict,
      payload: { url: 'https://github.com/compai/app/pull/42', verdict: 'failed', headSha: 'abc' },
    })

    expect(fake.prEvents).toHaveLength(1)
    expect(fake.prEvents[0]?.deliveredAt).toBeNull()
  })

  it('replays undelivered rows oldest-first and stamps them delivered', async () => {
    const { mailbox } = serviceWith()
    const older = new Date('2026-10-08T10:00:00.000Z')
    const newer = new Date('2026-10-08T11:00:00.000Z')
    fake.prEvents.push(
      {
        id: 'evt_newer',
        userId: 'usr-a',
        repoFullName: 'compai/app',
        prNumber: 42,
        kind: 'comment',
        payload: { url: 'u2', authorLogin: 'x' },
        deliveredAt: null,
        createdAt: newer,
      },
      {
        id: 'evt_older',
        userId: 'usr-a',
        repoFullName: 'compai/app',
        prNumber: 42,
        kind: 'comment',
        payload: { url: 'u1', authorLogin: 'x' },
        deliveredAt: null,
        createdAt: older,
      },
      {
        id: 'evt_done',
        userId: 'usr-a',
        repoFullName: 'compai/app',
        prNumber: 42,
        kind: 'comment',
        payload: { url: 'u0', authorLogin: 'x' },
        deliveredAt: new Date('2026-10-08T09:00:00.000Z'),
        createdAt: new Date('2026-10-08T08:00:00.000Z'),
      },
      {
        id: 'evt_other',
        userId: 'usr-b',
        repoFullName: 'compai/app',
        prNumber: 42,
        kind: 'comment',
        payload: { url: 'u9', authorLogin: 'x' },
        deliveredAt: null,
        createdAt: older,
      },
    )

    const events = await mailbox.replayUndelivered({ userId: 'usr-a' })

    expect(events.map((event) => event.id)).toEqual(['evt_older', 'evt_newer'])
    expect(events[0]?.createdAt).toBe(older.toISOString())
    const byId = new Map(fake.prEvents.map((row) => [row.id, row]))
    expect(byId.get('evt_older')?.deliveredAt).not.toBeNull()
    expect(byId.get('evt_newer')?.deliveredAt).not.toBeNull()
    expect(byId.get('evt_done')?.deliveredAt).toEqual(new Date('2026-10-08T09:00:00.000Z'))
    expect(byId.get('evt_other')?.deliveredAt).toBeNull()
  })

  it('a second replay is empty — delivered rows never replay twice', async () => {
    const { mailbox } = serviceWith()
    fake.prEvents.push({
      id: 'evt_1',
      userId: 'usr-a',
      repoFullName: 'compai/app',
      prNumber: 42,
      kind: 'comment',
      payload: { url: 'u1', authorLogin: 'x' },
      deliveredAt: null,
      createdAt: new Date(),
    })

    const first = await mailbox.replayUndelivered({ userId: 'usr-a' })
    const second = await mailbox.replayUndelivered({ userId: 'usr-a' })

    expect(first).toHaveLength(1)
    expect(second).toHaveLength(0)
  })
})
