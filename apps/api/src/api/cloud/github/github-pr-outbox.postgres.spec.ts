import { randomUUID } from 'node:crypto'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it, vi } from 'bun:test'
import { recordingSignals } from '../../platform/sessions/thread-signals.fixture'
import {
  claimPrOutboxRows,
  completePrOutboxRow,
  PR_OUTBOX_MAX_ATTEMPTS,
} from './github-pr-outbox-lease'
import { GithubPrOutboxDispatcher } from './github-pr-outbox'
import type { GithubSandboxWakeService } from './github-sandbox-wake.service'

const AT = new Date('2026-11-18T10:00:00Z')

const signalRow = (args: { createdAt: Date; id?: string }) => ({
  id: args.id ?? `out_${randomUUID()}`,
  kind: 'thread-signal',
  repoFullName: 'compai/app',
  prNumber: 42,
  payload: { threadId: 'thr_1' },
  dedupeKey: `thread-signal:${randomUUID()}`,
  createdAt: args.createdAt,
  dispatchedAt: null,
  attempts: 0,
  lastError: null,
})

const fanoutRow = (args: { createdAt: Date; id?: string }) => ({
  ...signalRow(args),
  kind: 'fanout',
  payload: { userIds: ['usr-a'], state: { repoFullName: 'compai/app', prNumber: 42 } },
})

const wakeRow = (args: { createdAt: Date }) => ({
  ...signalRow(args),
  kind: 'wake',
  payload: {
    notice: { userId: 'usr-a', repoFullName: 'compai/app', prNumber: 42 },
    event: {
      userId: 'usr-a',
      repoFullName: 'compai/app',
      prNumber: 42,
      kind: 'verdict',
      payload: { url: 'https://github.com/compai/app/pull/42', verdict: 'green', headSha: 'abc' },
    },
  },
})

function rig(args: {
  push?: (input: unknown) => void
  wake?: () => Promise<void>
  now?: () => Date
}) {
  const { signals, changedThreads } = recordingSignals()
  const push = vi.fn((input: unknown) => args.push?.(input))
  const dispatcher = new GithubPrOutboxDispatcher({
    fanout: { push, pushEvent: vi.fn() },
    signals,
    wake: { notifyEvent: async () => args.wake?.() } as unknown as GithubSandboxWakeService,
    reconcile: async () => undefined,
    logger: { warn: () => undefined },
    now: args.now ?? (() => AT),
  })

  return { dispatcher, push, changedThreads }
}

const reload = (id: string) => db.orm.public.GithubPrOutbox.where({ id }).first()

describe('GithubPrOutboxDispatcher leases', () => {
  useTestDatabase()

  it('re-runs the effects a dispatcher claimed and then died on, once the lease expires', async () => {
    const first = await db.orm.public.GithubPrOutbox.create(signalRow({ createdAt: AT }))
    const second = await db.orm.public.GithubPrOutbox.create(
      signalRow({ createdAt: new Date(AT.getTime() + 1) }),
    )
    const claimed = await claimPrOutboxRows({
      now: new Date(0),
      owner: 'outbox_dead',
      limit: 32,
    })
    expect(claimed.rows.map((row) => row.id).sort()).toEqual([first.id, second.id].sort())

    const { dispatcher, changedThreads } = rig({})

    expect(await dispatcher.drain()).toBe(2)

    expect(changedThreads).toHaveLength(2)
    expect((await reload(first.id))?.dispatchedAt).not.toBeNull()
    expect((await reload(second.id))?.dispatchedAt).not.toBeNull()
  })

  it('refuses the completion of a stale owner after the row was reclaimed', async () => {
    const row = await db.orm.public.GithubPrOutbox.create(signalRow({ createdAt: AT }))
    await claimPrOutboxRows({ now: new Date(0), owner: 'outbox_stale', limit: 1 })
    const reclaimed = await claimPrOutboxRows({ now: AT, owner: 'outbox_fresh', limit: 1 })
    expect(reclaimed.rows.map((held) => held.id)).toEqual([row.id])

    expect(await completePrOutboxRow({ id: row.id, owner: 'outbox_stale', now: AT })).toBe(false)
    expect((await reload(row.id))?.dispatchedAt).toBeNull()
  })

  it('runs each effect once when an inline dispatch and a drain race the same row', async () => {
    const row = await db.orm.public.GithubPrOutbox.create(signalRow({ createdAt: AT }))
    const { dispatcher, changedThreads } = rig({})

    const drain = dispatcher.drain()
    const inline = dispatcher.dispatch([row.id])
    await Promise.all([drain, inline])

    expect(changedThreads).toHaveLength(1)
    expect((await reload(row.id))?.attempts).toBe(0)
  })

  it('acks a wake row only after its notifyEvent promise resolves', async () => {
    const row = await db.orm.public.GithubPrOutbox.create(wakeRow({ createdAt: AT }))
    let release: () => void = () => undefined
    const durable = new Promise<void>((resolve) => {
      release = resolve
    })
    const { dispatcher } = rig({ wake: () => durable })

    const draining = dispatcher.drain()
    await Bun.sleep(30)
    expect((await reload(row.id))?.dispatchedAt).toBeNull()

    release()
    await draining
    expect((await reload(row.id))?.dispatchedAt).not.toBeNull()
  })

  it('leaves a wake row pending with a backoff when the wake fails', async () => {
    const row = await db.orm.public.GithubPrOutbox.create(wakeRow({ createdAt: AT }))
    const { dispatcher } = rig({
      wake: async () => {
        throw new Error('wake down')
      },
    })

    expect(await dispatcher.drain()).toBe(1)

    const stored = await reload(row.id)
    expect(stored).toMatchObject({ dispatchedAt: null, attempts: 1, deadLetteredAt: null })
    expect(stored?.lastError).toContain('wake down')
    expect(stored?.nextAttemptAt?.getTime()).toBeGreaterThan(AT.getTime())
  })

  it('delivers a valid row behind a full batch of poison rows', async () => {
    const poison = Array.from({ length: 32 }, (_, index) =>
      fanoutRow({ createdAt: new Date(AT.getTime() + index) }),
    )
    await db.orm.public.GithubPrOutbox.createAndCount(poison)
    const valid = await db.orm.public.GithubPrOutbox.create(
      signalRow({ createdAt: new Date(AT.getTime() + 100) }),
    )
    const { dispatcher, changedThreads } = rig({
      push: () => {
        throw new Error('poison')
      },
    })

    expect(await dispatcher.drain()).toBe(32)
    expect(changedThreads).toHaveLength(0)

    expect(await dispatcher.drain()).toBe(1)
    expect(changedThreads).toHaveLength(1)
    expect((await reload(valid.id))?.dispatchedAt).not.toBeNull()
  })

  it('dead-letters a row after the bounded number of attempts and keeps it', async () => {
    const row = await db.orm.public.GithubPrOutbox.create(fanoutRow({ createdAt: AT }))
    let clock = AT
    const { dispatcher } = rig({
      push: () => {
        throw new Error('poison')
      },
      now: () => clock,
    })

    for (let attempt = 0; attempt < PR_OUTBOX_MAX_ATTEMPTS; attempt += 1) {
      expect(await dispatcher.drain()).toBe(1)
      clock = new Date(clock.getTime() + 60 * 60 * 1000)
    }

    const stored = await reload(row.id)
    expect(stored).toMatchObject({
      attempts: PR_OUTBOX_MAX_ATTEMPTS,
      dispatchedAt: null,
    })
    expect(stored?.deadLetteredAt).not.toBeNull()
    expect(await db.orm.public.GithubPrOutbox.all()).toHaveLength(1)
    expect(await dispatcher.drain()).toBe(0)
  })
})
