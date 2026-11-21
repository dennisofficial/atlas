import { randomUUID } from 'node:crypto'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it, vi } from 'bun:test'
import { recordingSignals } from '../../platform/sessions/thread-signals.fixture'
import {
  claimPrOutboxRows,
  completePrOutboxRows,
  PR_OUTBOX_LEASE_MS,
  PR_OUTBOX_MAX_ATTEMPTS,
} from './github-pr-outbox-lease'
import { GithubPrOutboxDispatcher, PR_OUTBOX_RETENTION_MS } from './github-pr-outbox'
import { GithubHttpBudgetUnavailable } from './github-request-budget'
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

const reconcileRow = (args: { createdAt: Date }) => ({
  ...signalRow(args),
  kind: 'reconcile-checks',
  payload: { repoFullName: 'compai/app', headSha: 'abc123' },
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

function wakeGate(): { entered: Promise<void>; release: () => void; wake: () => Promise<void> } {
  let markEntered: () => void = () => undefined
  let release: () => void = () => undefined
  const entered = new Promise<void>((resolve) => {
    markEntered = resolve
  })
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  let calls = 0
  return {
    entered,
    release: () => release(),
    wake: async () => {
      calls += 1
      if (calls > 1) return
      markEntered()
      await held
    },
  }
}

function rig(args: {
  push?: (input: unknown) => void
  wake?: () => Promise<void>
  reconcile?: (input: { repoFullName: string; headSha: string }) => Promise<void>
  now?: () => Date
}) {
  const { signals, changedThreads } = recordingSignals()
  const push = vi.fn((input: unknown) => args.push?.(input))
  const dispatcher = new GithubPrOutboxDispatcher({
    fanout: { push, pushEvent: vi.fn() },
    signals,
    wake: { notifyEvent: async () => args.wake?.() } as unknown as GithubSandboxWakeService,
    reconcile: async (input) => args.reconcile?.(input),
    mergeability: async () => undefined,
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
    const claimed = await claimPrOutboxRows({ now: new Date(0), limit: 32 })
    expect(claimed.rows.map((row) => row.id).sort()).toEqual([first.id, second.id].sort())

    const { dispatcher, changedThreads } = rig({})

    expect(await dispatcher.drain()).toBe(2)

    expect(changedThreads).toHaveLength(2)
    expect((await reload(first.id))?.dispatchedAt).not.toBeNull()
    expect((await reload(second.id))?.dispatchedAt).not.toBeNull()
  })

  it('refuses the completion of a claim another claimant has taken over', async () => {
    const row = await db.orm.public.GithubPrOutbox.create(signalRow({ createdAt: AT }))
    const stale = await claimPrOutboxRows({ now: new Date(0), limit: 1 })
    const fresh = await claimPrOutboxRows({ now: AT, limit: 1 })
    expect(fresh.rows.map((held) => held.id)).toEqual([row.id])

    expect(await completePrOutboxRows({ ids: [row.id], token: stale.token, now: AT })).toBe(0)
    expect((await reload(row.id))?.dispatchedAt).toBeNull()
  })

  it('fences the completion of a claim the same dispatcher lost and reclaimed', async () => {
    const row = await db.orm.public.GithubPrOutbox.create(wakeRow({ createdAt: AT }))
    const gate = wakeGate()
    let clock = AT
    const { dispatcher } = rig({ wake: gate.wake, now: () => clock })

    const first = dispatcher.drain()
    await gate.entered
    clock = new Date(AT.getTime() + PR_OUTBOX_LEASE_MS + 60_000)
    expect(await dispatcher.drain()).toBe(1)
    const reclaimed = await reload(row.id)
    expect(reclaimed?.dispatchedAt?.getTime()).toBe(clock.getTime())

    clock = new Date(clock.getTime() + 60_000)
    gate.release()
    expect(await first).toBe(1)

    const after = await reload(row.id)
    expect(after?.dispatchedAt?.getTime()).toBe(reclaimed?.dispatchedAt?.getTime())
    expect(after).toMatchObject({ attempts: 0, leaseOwner: null })
  })

  it('renews a claim whose lease is half spent, so a batch that outlives its lease still completes', async () => {
    const first = await db.orm.public.GithubPrOutbox.create(reconcileRow({ createdAt: AT }))
    const second = await db.orm.public.GithubPrOutbox.create(
      reconcileRow({ createdAt: new Date(AT.getTime() + 1) }),
    )
    let clock = AT
    const leases: (number | null)[] = []
    const { dispatcher } = rig({
      now: () => clock,
      reconcile: async () => {
        const held = await reload(second.id)
        leases.push(held?.leaseUntil?.getTime() ?? null)
        clock = new Date(clock.getTime() + PR_OUTBOX_LEASE_MS + 1_000)
      },
    })

    expect(await dispatcher.drain()).toBe(2)

    expect(leases).toHaveLength(2)
    expect(leases[1]).toBeGreaterThan(leases[0] ?? 0)
    for (const id of [first.id, second.id]) {
      expect(await reload(id)).toMatchObject({ attempts: 0, leaseOwner: null })
      expect((await reload(id))?.dispatchedAt).not.toBeNull()
    }
    expect(await dispatcher.drain()).toBe(0)
  })

  it('leaves a fresh claim alone for effects that run well inside its lease', async () => {
    const first = await db.orm.public.GithubPrOutbox.create({
      ...reconcileRow({ createdAt: AT }),
      id: 'out_first',
      payload: { repoFullName: 'compai/app', headSha: 'out_first' },
    })
    const second = await db.orm.public.GithubPrOutbox.create({
      ...reconcileRow({ createdAt: new Date(AT.getTime() + 1) }),
      id: 'out_second',
      payload: { repoFullName: 'compai/app', headSha: 'out_second' },
    })
    let clock = AT
    const leases: Record<string, number | null> = {}
    const { dispatcher } = rig({
      now: () => clock,
      reconcile: async ({ headSha }) => {
        leases[headSha] = (await reload(headSha))?.leaseUntil?.getTime() ?? null
        clock = new Date(clock.getTime() + 20_000)
      },
    })

    expect(await dispatcher.drain()).toBe(2)

    for (const id of [first.id, second.id])
      expect(leases[id]).toBe(AT.getTime() + PR_OUTBOX_LEASE_MS)
    for (const id of [first.id, second.id]) {
      expect((await reload(id))?.dispatchedAt).not.toBeNull()
    }
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
    const gate = wakeGate()
    const { dispatcher } = rig({ wake: gate.wake })

    const draining = dispatcher.drain()
    await gate.entered
    expect((await reload(row.id))?.dispatchedAt).toBeNull()

    gate.release()
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

  it('parks a row the budget refused until its window opens, without spending an attempt', async () => {
    const row = await db.orm.public.GithubPrOutbox.create(reconcileRow({ createdAt: AT }))
    const until = AT.getTime() + 4 * 60_000
    let clock = AT
    const { dispatcher } = rig({
      now: () => clock,
      reconcile: async () => {
        throw new GithubHttpBudgetUnavailable(undefined, until)
      },
    })

    expect(await dispatcher.drain()).toBe(1)
    expect((await reload(row.id))?.nextAttemptAt?.getTime()).toBe(until)

    for (let round = 0; round < PR_OUTBOX_MAX_ATTEMPTS + 1; round += 1) {
      clock = new Date(clock.getTime() + 5 * 60_000)
      expect(await dispatcher.drain()).toBe(1)
      const stored = await reload(row.id)
      expect(stored).toMatchObject({ dispatchedAt: null, attempts: 0, deadLetteredAt: null })
      expect(stored?.nextAttemptAt?.getTime()).toBeGreaterThan(clock.getTime())
    }
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

    expect(await dispatcher.drain()).toBe(33)
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

describe('GithubPrOutboxDispatcher prune', () => {
  useTestDatabase()

  it('deletes the dispatched rows past the retention window and keeps every other row', async () => {
    const stale = new Date(AT.getTime() - PR_OUTBOX_RETENTION_MS - 1_000)
    const fresh = new Date(AT.getTime() - PR_OUTBOX_RETENTION_MS + 1_000)
    const dispatchedStale = await db.orm.public.GithubPrOutbox.create({
      ...signalRow({ createdAt: stale }),
      dispatchedAt: stale,
    })
    const dispatchedFresh = await db.orm.public.GithubPrOutbox.create({
      ...signalRow({ createdAt: fresh }),
      dispatchedAt: fresh,
    })
    const pending = await db.orm.public.GithubPrOutbox.create(signalRow({ createdAt: stale }))
    const deadLettered = await db.orm.public.GithubPrOutbox.create({
      ...fanoutRow({ createdAt: stale }),
      deadLetteredAt: stale,
    })
    const { dispatcher } = rig({ now: () => AT })

    expect(await dispatcher.prune({ now: AT })).toBe(1)

    const remaining = (await db.orm.public.GithubPrOutbox.all()).map((row) => row.id)
    expect(remaining).not.toContain(dispatchedStale.id)
    expect(remaining.sort()).toEqual([dispatchedFresh.id, pending.id, deadLettered.id].sort())
    expect(await reload(pending.id)).not.toBeNull()
    expect(await reload(deadLettered.id)).not.toBeNull()
  })

  it('keeps a dispatched row sitting exactly on the retention boundary', async () => {
    const boundary = new Date(AT.getTime() - PR_OUTBOX_RETENTION_MS)
    const row = await db.orm.public.GithubPrOutbox.create({
      ...signalRow({ createdAt: boundary }),
      dispatchedAt: boundary,
    })
    const { dispatcher } = rig({ now: () => AT })

    expect(await dispatcher.prune({ now: AT })).toBe(0)
    expect(await reload(row.id)).not.toBeNull()
  })
})
