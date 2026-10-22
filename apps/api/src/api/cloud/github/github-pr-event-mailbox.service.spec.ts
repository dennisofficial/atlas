import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { ensureUsers, prEventRows, seedPrEvent } from '../../../../test/github-seed'
import { DrainStateService } from '../../platform/health/drain-state.service'
import { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import { EPrEventKind } from './github-realtime.types'
import type { GithubSandboxWakeService } from './github-sandbox-wake.service'

function serviceWith(): {
  mailbox: GithubPrEventMailboxService
  fanout: GithubPrFanoutService
} {
  const fanout = new GithubPrFanoutService(new DrainStateService())
  const wake = { notifyEvent: () => undefined } as unknown as GithubSandboxWakeService
  return { mailbox: new GithubPrEventMailboxService(fanout, wake), fanout }
}

describe('GithubPrEventMailboxService', () => {
  useTestDatabase()

  beforeEach(async () => {
    await ensureUsers('usr-a', 'usr-b', 'usr-offline')
  })

  it('stamps deliveredAt on rows whose live push reached a stream', async () => {
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
    await vi.waitFor(async () => {
      expect((await prEventRows()).every((row) => row.deliveredAt !== null)).toBe(true)
    })

    expect(await prEventRows()).toHaveLength(2)
    expect(receivedA).toHaveLength(1)
    expect(receivedB).toHaveLength(1)
    expect(receivedA[0]).toMatchObject({ kind: 'comment', repoFullName: 'compai/app', prNumber: 42 })
  })

  it('stamps only the row a live stream received — an offline subscriber still replays', async () => {
    const { mailbox, fanout } = serviceWith()
    fanout.openStream({
      userId: 'usr-a',
      handler: () => undefined,
      eventHandler: () => undefined,
    })

    await mailbox.record({
      userIds: ['usr-a', 'usr-offline'],
      repoFullName: 'compai/app',
      prNumber: 42,
      kind: EPrEventKind.Verdict,
      payload: { url: 'https://github.com/compai/app/pull/42', verdict: 'green', headSha: 'abc' },
    })
    await vi.waitFor(async () => {
      expect((await prEventRows()).find((row) => row.userId === 'usr-a')?.deliveredAt).not.toBeNull()
    })

    expect((await prEventRows()).find((row) => row.userId === 'usr-offline')?.deliveredAt).toBeNull()
    const replayed = await mailbox.replayUndelivered({ userId: 'usr-offline' })
    expect(replayed).toHaveLength(1)
    expect(await mailbox.replayUndelivered({ userId: 'usr-a' })).toHaveLength(0)
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

    const rows = await prEventRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.deliveredAt).toBeNull()
  })

  it('replays undelivered rows oldest-first and stamps them delivered', async () => {
    const { mailbox } = serviceWith()
    const older = new Date('2026-10-08T10:00:00.000Z')
    const newer = new Date('2026-10-08T11:00:00.000Z')
    for (const row of [
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
    ]) {
      await seedPrEvent(row)
    }

    const events = await mailbox.replayUndelivered({ userId: 'usr-a' })

    expect(events.map((event) => event.id)).toEqual(['evt_older', 'evt_newer'])
    expect(events[0]?.createdAt).toBe(older.toISOString())
    const byId = new Map((await prEventRows()).map((row) => [row.id, row]))
    expect(byId.get('evt_older')?.deliveredAt).not.toBeNull()
    expect(byId.get('evt_newer')?.deliveredAt).not.toBeNull()
    expect(byId.get('evt_done')?.deliveredAt).toEqual(new Date('2026-10-08T09:00:00.000Z'))
    expect(byId.get('evt_other')?.deliveredAt).toBeNull()
  })

  it('a second replay is empty — delivered rows never replay twice', async () => {
    const { mailbox } = serviceWith()
    await seedPrEvent({ id: 'evt_1', userId: 'usr-a', payload: { url: 'u1', authorLogin: 'x' } })

    const first = await mailbox.replayUndelivered({ userId: 'usr-a' })
    const second = await mailbox.replayUndelivered({ userId: 'usr-a' })

    expect(first).toHaveLength(1)
    expect(second).toHaveLength(0)
  })
})
