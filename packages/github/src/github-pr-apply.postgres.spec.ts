import { EPrState, foldPrObservations } from '@dltech/atlas-core'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { seedSubscription } from './testing/github-seed'
import {
  checkRunInputOf,
  commitChecksTally,
  recordCommitChecksLocked,
} from './github-commit-checks'
import { applyArgs, pull, rig } from './github-pr-apply.fixture'
import type { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
import { GithubPrOutboxDispatcher } from './github-pr-outbox'
import { inertHeldGreen, inertMergeabilityRefresh, inertReconcile } from './github-pr-store.fixture'

const seedSettledCheck = (args: { outcome: string } = { outcome: 'passed' }) =>
  recordCommitChecksLocked({
    repoFullName: 'compai/app',
    headSha: 'abc123',
    checks: [
      checkRunInputOf({
        id: 1,
        name: 'ci',
        status: 'completed',
        conclusion: args.outcome,
        started_at: '2026-11-18T09:59:00Z',
        completed_at: '2026-11-18T10:00:00Z',
      }),
    ],
  })

describe('GithubPrStore.apply', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedSubscription({ userId: 'usr-a', prNumber: 42, threadId: 'thr_1' })
  })

  it('folds eight concurrent applies of an absent row into one row and one verdict', async () => {
    await seedSettledCheck()
    const { store } = rig()
    const observations = [
      pull({ pullUpdatedAt: '2026-11-18T10:00:00Z' }),
      pull({
        pullUpdatedAt: '2026-11-18T10:04:00Z',
        state: EPrState.Closed,
        closedAt: '2026-11-18T10:04:00Z',
      }),
      pull({ pullUpdatedAt: '2026-11-18T10:02:00Z', title: 'add the other thing' }),
    ]
    const folded = foldPrObservations({ state: null, observations })

    await Promise.all(
      Array.from({ length: 8 }, () =>
        store.apply(applyArgs([...observations].sort(() => Math.random() - 0.5))),
      ),
    )

    const rows = await db.orm.public.GithubPrState.all()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      state: folded.state?.pull?.state,
      title: folded.state?.pull?.title,
      headSha: folded.state?.pull?.headSha,
    })
    const events = await db.orm.public.GithubPrEvent.all()
    expect(events.map((event) => event.kind)).toEqual(['verdict'])
  })

  it('writes no row, outbox or event when the transition delivery throws', async () => {
    await seedSettledCheck({ outcome: 'failure' })
    const push = vi.fn()
    const mailbox = {
      record: async () => {
        throw new Error('mailbox down')
      },
    } as unknown as GithubPrEventMailboxService
    const { store } = rig({ mailbox, fanout: { push, pushEvent: vi.fn() } })

    await expect(store.apply(applyArgs([pull()]))).rejects.toThrow('mailbox down')

    expect(await db.orm.public.GithubPrState.all()).toHaveLength(0)
    expect(await db.orm.public.GithubPrOutbox.all()).toHaveLength(0)
    expect(await db.orm.public.GithubPrEvent.all()).toHaveLength(0)
    expect(push).not.toHaveBeenCalled()
  })

  it('drains a committed effect exactly once after the dispatcher dies', async () => {
    const push = vi.fn(() => {
      throw new Error('stream down')
    })
    const { store } = rig({ fanout: { push, pushEvent: vi.fn() } })

    await store.apply(applyArgs([pull()]))

    const pending = await db.orm.public.GithubPrOutbox.all()
    expect(pending.map((row) => row.kind)).toEqual(['fanout'])
    expect(pending[0]).toMatchObject({ dispatchedAt: null, attempts: 1 })

    const received: unknown[] = []
    const healthy = new GithubPrOutboxDispatcher({
      fanout: { push: (args) => void received.push(args), pushEvent: vi.fn() },
      reconcile: inertReconcile(),
      mergeability: inertMergeabilityRefresh(),
      confirmGreen: inertHeldGreen(),
      now: () => new Date(Date.now() + 60_000),
    })
    expect(await healthy.drain()).toBe(1)
    expect(received).toHaveLength(1)
    expect(await healthy.drain()).toBe(0)
  })

  it('serializes a check write against an apply so the row never disagrees with the ledger and no green verdict lands while an attempt runs', async () => {
    const { store } = rig()
    await store.apply(applyArgs([pull()]))
    const tallyOf = () =>
      db.transaction((tx) =>
        commitChecksTally({ tx, repoFullName: 'compai/app', headSha: 'abc123' }),
      )
    for (let round = 0; round < 4; round += 1) {
      await Promise.all([
        store.applyChecks({
          repoFullName: 'compai/app',
          headSha: 'abc123',
          checks: [
            checkRunInputOf({
              id: round + 1,
              name: `job-${round}`,
              status: 'in_progress',
              conclusion: null,
              started_at: '2026-11-18T10:00:00Z',
            }),
          ],
        }),
        store.apply(applyArgs([])),
      ])
      const tally = await tallyOf()
      expect((await db.orm.public.GithubPrState.all())[0]).toMatchObject({
        checksRunning: tally.running,
        checksPassed: tally.passed,
        checksFailed: tally.failed,
        checksIgnored: tally.ignored,
      })
      expect(tally).toMatchObject({ running: round + 1, passed: 0 })
    }
    const verdicts = (await db.orm.public.GithubPrEvent.all()).filter(
      (event) => event.kind === 'verdict',
    )
    expect(verdicts).toHaveLength(0)
  })

  it('stores expected until a required check reports, then the tally rollup', async () => {
    await db.orm.public.GithubBranchProtection.create({
      repoFullName: 'compai/app',
      baseBranch: 'main',
      requiredContexts: ['ci'],
      fetchedAt: new Date(),
    })
    const { store } = rig()

    const waiting = await store.apply(applyArgs([pull()]))

    expect(waiting.row?.checksState).toBe('expected')
    const frames = (await db.orm.public.GithubPrOutbox.all()).filter((row) => row.kind === 'fanout')
    expect(frames).toHaveLength(1)
    expect(frames[0]?.payload).toMatchObject({ state: { checksState: 'expected' } })

    await seedSettledCheck()
    const reported = await store.apply(applyArgs([]))

    expect(reported.row?.checksState).toBe('success')
  })

  it('numbers each committed apply of a PR one higher than the last', async () => {
    const { store } = rig()

    const first = await store.apply(applyArgs([pull()]))
    const second = await store.apply(
      applyArgs([pull({ title: 'add the other thing', pullUpdatedAt: '2026-11-18T10:00:01Z' })]),
    )

    expect([first.row?.version, second.row?.version]).toEqual([1, 2])
  })

  it('never reopens a merge from a REST sample older than the stored one', async () => {
    const { store } = rig()
    await store.apply(
      applyArgs([
        pull({
          state: EPrState.Merged,
          pullUpdatedAt: '2026-11-18T10:05:00Z',
          mergedAt: '2026-11-18T10:05:00Z',
          closedAt: '2026-11-18T10:05:00Z',
        }),
      ]),
    )
    const stale = await store.apply(applyArgs([pull({ pullUpdatedAt: '2026-11-18T10:01:00Z' })]))

    expect(stale.applied).toBe(false)
    const rows = await db.orm.public.GithubPrState.all()
    expect(rows[0]?.state).toBe(EPrState.Merged)
  })
})

describe('GithubPrStore.apply on a tracked head nobody subscribed to', () => {
  useTestDatabase()

  it('derives the row but writes no event, delivery or inbox', async () => {
    const { store } = rig()

    const applied = await store.apply(applyArgs([pull()]))

    expect(applied.applied).toBe(true)
    expect(await db.orm.public.GithubPrState.all()).toHaveLength(1)
    expect(await db.orm.public.GithubPrEvent.all()).toHaveLength(0)
    expect(await db.orm.public.GithubPrEventDelivery.all()).toHaveLength(0)
    expect(await db.orm.public.GithubWebhookInbox.all()).toHaveLength(0)
    expect((await db.orm.public.GithubPrOutbox.all()).map((row) => row.kind)).toEqual(['fanout'])
  })
})
