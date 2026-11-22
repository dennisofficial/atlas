import { randomUUID } from 'node:crypto'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'
import { recordingSignals } from '../../platform/sessions/thread-signals.fixture'
import { GithubPrOutboxDispatcher } from './github-pr-outbox'
import {
  claimPrOutboxRows,
  PR_OUTBOX_PARK_EXPIRE_MS,
  PR_OUTBOX_PARK_MS,
  prOutboxBackoffMs,
} from './github-pr-outbox-lease'
import { GithubHttpBudgetUnavailable } from './github-request-budget'
import { legacyOf } from './github-legacy-effects.fixture'

const AT = new Date('2026-11-18T10:00:00Z')

const signalRow = (args: { createdAt: Date }) => ({
  id: `out_${randomUUID()}`,
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

const reconcileRow = (args: { createdAt: Date }) => ({
  ...signalRow(args),
  kind: 'reconcile-checks',
  payload: { repoFullName: 'compai/app', headSha: 'abc123' },
})

const parkedRow = (args: { id?: string; attempts?: number; now: Date }) => {
  const parkedAt = new Date(args.now.getTime() - PR_OUTBOX_PARK_EXPIRE_MS - 1_000)

  return {
    ...signalRow({ createdAt: parkedAt }),
    ...(args.id === undefined ? {} : { id: args.id }),
    attempts: args.attempts ?? 0,
    nextAttemptAt: args.now,
    parkedSince: parkedAt,
  }
}

function rig(args: { now: () => Date; reconcile: () => Promise<void> }) {
  const { signals, changedThreads } = recordingSignals()
  const dispatcher = new GithubPrOutboxDispatcher({
    fanout: { push: () => undefined, pushEvent: () => undefined },
    legacy: legacyOf({ signals: signals, wake: { notifyEvent: async () => undefined } }),
    reconcile: args.reconcile,
    mergeability: async () => undefined,
    logger: { warn: () => undefined },
    now: args.now,
  })

  return { dispatcher, changedThreads }
}

const reload = (id: string) => db.orm.public.GithubPrOutbox.where({ id }).first()

describe('GithubPrOutboxDispatcher parked rows', () => {
  useTestDatabase()

  it('never leases a row it retires in the same claim', async () => {
    const parked = await db.orm.public.GithubPrOutbox.create(parkedRow({ now: AT }))
    const retriedOnce = await db.orm.public.GithubPrOutbox.create(
      parkedRow({ now: AT, attempts: 1 }),
    )
    const live = await db.orm.public.GithubPrOutbox.create(signalRow({ createdAt: AT }))

    const claim = await claimPrOutboxRows({ now: AT, limit: 32 })

    expect(claim.rows.map((row) => row.id)).toEqual([live.id])
    expect(claim.deadLettered.map((row) => row.id).sort()).toEqual(
      [parked.id, retriedOnce.id].sort(),
    )
    for (const id of [parked.id, retriedOnce.id]) {
      const stored = await reload(id)
      expect(stored).toMatchObject({ dispatchedAt: null, leaseOwner: null, leaseUntil: null })
      expect(stored?.deadLetteredAt).not.toBeNull()
    }
    expect((await reload(live.id))?.leaseOwner).not.toBeNull()
  })

  it('runs the live row and retires the parked one in the same drain', async () => {
    const retired = await db.orm.public.GithubPrOutbox.create(parkedRow({ now: AT }))
    const live = await db.orm.public.GithubPrOutbox.create(signalRow({ createdAt: AT }))
    const { dispatcher, changedThreads } = rig({
      now: () => AT,
      reconcile: async () => undefined,
    })

    expect(await dispatcher.drain()).toBe(1)

    expect(changedThreads).toHaveLength(1)
    const executed = await reload(live.id)
    expect(executed).toMatchObject({ attempts: 0, deadLetteredAt: null, parkedSince: null })
    expect(executed?.dispatchedAt).not.toBeNull()
    const expired = await reload(retired.id)
    expect(expired).toMatchObject({ attempts: 0, dispatchedAt: null })
    expect(expired?.deadLetteredAt).not.toBeNull()
  })

  it('retires a row still refused past the park window after a genuine failure', async () => {
    const row = await db.orm.public.GithubPrOutbox.create(reconcileRow({ createdAt: AT }))
    let clock = AT
    let parkUntil = AT
    let refused = false
    const { dispatcher } = rig({
      now: () => clock,
      reconcile: async () => {
        if (refused) throw new GithubHttpBudgetUnavailable(undefined, parkUntil.getTime())
        throw new Error('read failed')
      },
    })

    expect(await dispatcher.drain()).toBe(1)
    expect(await reload(row.id)).toMatchObject({ attempts: 1, parkedSince: null })

    clock = new Date(AT.getTime() + prOutboxBackoffMs(1))
    refused = true
    parkUntil = new Date(clock.getTime() + PR_OUTBOX_PARK_MS)
    expect(await dispatcher.drain()).toBe(1)
    const parked = await reload(row.id)
    expect(parked).toMatchObject({ attempts: 1, dispatchedAt: null, deadLetteredAt: null })
    expect(parked?.parkedSince?.getTime()).toBe(clock.getTime())

    clock = new Date(clock.getTime() + PR_OUTBOX_PARK_EXPIRE_MS + 1_000)
    parkUntil = new Date(clock.getTime() + PR_OUTBOX_PARK_MS)
    expect(await dispatcher.drain()).toBe(0)
    const retired = await reload(row.id)
    expect(retired).toMatchObject({ attempts: 1, dispatchedAt: null, parkedSince: null })
    expect(retired?.deadLetteredAt?.getTime()).toBe(clock.getTime())
  })

  it('leaves a row that parks briefly and then succeeds untouched', async () => {
    const row = await db.orm.public.GithubPrOutbox.create(reconcileRow({ createdAt: AT }))
    let clock = AT
    let refused = true
    const { dispatcher } = rig({
      now: () => clock,
      reconcile: async () => {
        if (!refused) return
        throw new GithubHttpBudgetUnavailable(undefined, clock.getTime() + PR_OUTBOX_PARK_MS)
      },
    })

    expect(await dispatcher.drain()).toBe(1)
    expect((await reload(row.id))?.parkedSince?.getTime()).toBe(AT.getTime())

    clock = new Date(AT.getTime() + PR_OUTBOX_PARK_MS)
    refused = false
    expect(await dispatcher.drain()).toBe(1)

    const stored = await reload(row.id)
    expect(stored).toMatchObject({ attempts: 0, deadLetteredAt: null, parkedSince: null })
    expect(stored?.dispatchedAt?.getTime()).toBe(clock.getTime())
  })
})
