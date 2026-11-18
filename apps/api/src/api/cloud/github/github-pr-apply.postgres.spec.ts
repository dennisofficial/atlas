import {
  EPrSource,
  EPrState,
  foldPrObservations,
  type PrObservation,
  type PullSample,
} from '@dltech/atlas-core'
import {
  commitChecksTally,
  checkRunInputOf,
  recordCommitChecksLocked,
} from './github-commit-checks'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { seedSubscription } from '../../../../test/github-seed'
import { DrainStateService } from '../../platform/health/drain-state.service'
import { recordingSignals } from '../../platform/sessions/thread-signals.fixture'
import { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import { GithubPrOutboxDispatcher } from './github-pr-outbox'
import { GithubPrStore } from './github-pr-store'
import type { GithubSandboxWakeService } from './github-sandbox-wake.service'

const SAMPLE: PullSample = {
  repoFullName: 'compai/app',
  prNumber: 42,
  title: 'add the thing',
  url: 'https://github.com/compai/app/pull/42',
  state: EPrState.Open,
  headBranch: 'dennis/add-the-thing',
  headSha: 'abc123',
  headRepoFullName: 'compai/app',
  baseBranch: 'main',
  pullUpdatedAt: '2026-11-18T10:00:00Z',
  closedAt: null,
  mergedAt: null,
}

const pull = (over: Partial<PullSample> = {}): PrObservation => ({
  kind: 'pull',
  source: EPrSource.Poll,
  observedAt: '2026-11-18T10:00:00Z',
  sample: { ...SAMPLE, ...over },
})

const applyArgs = (observations: readonly PrObservation[]) => ({
  repoFullName: 'compai/app',
  prNumber: 42,
  observations,
})

function rig(
  overrides: {
    mailbox?: GithubPrEventMailboxService
    fanout?: Pick<GithubPrFanoutService, 'push' | 'pushEvent'>
  } = {},
) {
  const fanout = new GithubPrFanoutService(new DrainStateService())
  const wake = { notifyEvent: vi.fn() } as unknown as GithubSandboxWakeService
  const { signals, changedThreads } = recordingSignals()
  const dispatcher = new GithubPrOutboxDispatcher({
    fanout: overrides.fanout ?? fanout,
    signals,
    wake,
  })
  const mailbox = overrides.mailbox ?? new GithubPrEventMailboxService(fanout, wake)

  return {
    store: new GithubPrStore({ mailbox, dispatcher }),
    fanout,
    wake,
    signals,
    changedThreads,
  }
}

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
    await seedSettledCheck()
    const push = vi.fn()
    const notifyEvent = vi.fn()
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
    expect(notifyEvent).not.toHaveBeenCalled()
  })

  it('drains a committed effect exactly once after the dispatcher dies', async () => {
    const push = vi.fn(() => {
      throw new Error('stream down')
    })
    const { store } = rig({ fanout: { push, pushEvent: vi.fn() } })

    await store.apply(applyArgs([pull()]))

    const pending = await db.orm.public.GithubPrOutbox.all()
    expect(pending.map((row) => row.kind)).toEqual(['fanout', 'thread-signal'])
    expect(pending[0]).toMatchObject({ dispatchedAt: null, attempts: 1 })
    expect(pending[1]?.dispatchedAt).not.toBeNull()

    const received: unknown[] = []
    const healthy = new GithubPrOutboxDispatcher({
      fanout: { push: (args) => void received.push(args), pushEvent: vi.fn() },
      signals: recordingSignals().signals,
      wake: { notifyEvent: vi.fn() } as unknown as GithubSandboxWakeService,
    })
    expect(await healthy.drain()).toBe(1)
    expect(received).toHaveLength(1)
    expect(await healthy.drain()).toBe(0)
  })

  it('keeps the stored tally equal to the commit ledger while a check write races an apply', async () => {
    const { store } = rig()
    await store.apply(applyArgs([pull()]))
    for (let round = 0; round < 4; round += 1) {
      await Promise.all([
        recordCommitChecksLocked({
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
    }
    await store.apply(applyArgs([]))

    const tally = await db.transaction((tx) =>
      commitChecksTally({ tx, repoFullName: 'compai/app', headSha: 'abc123' }),
    )
    const rows = await db.orm.public.GithubPrState.all()
    expect(rows[0]).toMatchObject({
      checksRunning: tally.running,
      checksPassed: tally.passed,
      checksFailed: tally.failed,
      checksIgnored: tally.ignored,
    })
    expect(tally.running).toBe(4)
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

  it('derives the row but writes no event, delivery, inbox or wake', async () => {
    const { store, wake, changedThreads } = rig()

    const applied = await store.apply(applyArgs([pull()]))

    expect(applied.applied).toBe(true)
    expect(await db.orm.public.GithubPrState.all()).toHaveLength(1)
    expect(await db.orm.public.GithubPrEvent.all()).toHaveLength(0)
    expect(await db.orm.public.GithubPrEventDelivery.all()).toHaveLength(0)
    expect(await db.orm.public.GithubWebhookInbox.all()).toHaveLength(0)
    expect(wake.notifyEvent).not.toHaveBeenCalled()
    expect(changedThreads).toHaveLength(0)
    expect((await db.orm.public.GithubPrOutbox.all()).map((row) => row.kind)).toEqual(['fanout'])
  })
})
