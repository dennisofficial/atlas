import { beforeEach, describe, expect, it } from 'bun:test'

import type { PrStateRow } from '../../port'
import type { ConformanceParams } from './conformance'
import { branches, forkBranches, prStateOf } from './conformance-views.fixture'
import {
  appendBodies,
  makeHarness,
  said,
  seedGranted,
  SESSION,
  THREAD,
  type Harness,
} from './support'

export function describeControlPlanePullRequestViews(params: ConformanceParams): void {
  describe(`ControlPlane tracked pull requests (${params.name})`, () => {
    let harness: Harness
    let epoch: number

    beforeEach(async () => {
      await params.reset()
      harness = makeHarness(params.makeStore())
      epoch = await seedGranted(harness)
    })

    const view = () => harness.plane.readSessionView({ sessionId: SESSION, threadId: THREAD })

    const seedPr = async (row: PrStateRow): Promise<void> => {
      const seed = params.seedPrState
      if (seed === undefined) throw new Error('the harness seeds no pull request state')
      await seed(row)
    }

    const subscribe = async (number: number) => {
      await params
        .makeStore()
        .transact((tx) =>
          tx.insertSessionPullRequests([
            { sessionId: SESSION, repo: 'github.com/Acme/App', number },
          ]),
        )
    }

    const observed = async () => (await view()).value.pullRequests

    it('keeps a tracked pull request once the branch leaves the observation', async () => {
      await seedPr(prStateOf({ number: 7, state: 'open', updatedAt: '2026-11-02T12:00:00.000Z' }))
      await appendBodies({ harness, epoch, bodies: [branches] })
      await appendBodies({
        harness,
        epoch,
        bodies: [
          {
            type: 'branches-observed',
            repo: '/work/app',
            head: 'other',
            base: 'main',
            branches: [{ name: 'other', sha: 'c3' }],
            worktrees: [],
            remotes: [{ name: 'origin', url: 'git@github.com:Acme/App.git' }],
          },
        ],
      })
      expect((await observed()).map((pullRequest) => pullRequest.number)).toEqual([7])
    })

    it('keeps a tracked pull request through a rewind', async () => {
      await seedPr(prStateOf({ number: 7, state: 'open', updatedAt: '2026-11-02T12:00:00.000Z' }))
      await appendBodies({ harness, epoch, bodies: [said('a'), branches] })
      await appendBodies({ harness, epoch, bodies: [{ type: 'history-rewound', toSeq: 1 }] })
      expect((await observed()).map((pullRequest) => pullRequest.number)).toEqual([7])
    })

    it('matches a fork head to the pull request opened upstream', async () => {
      await seedPr(
        prStateOf({
          number: 9,
          state: 'open',
          updatedAt: '2026-11-02T12:00:00.000Z',
          headRepoFullName: 'fork/app',
        }),
      )
      await appendBodies({ harness, epoch, bodies: [forkBranches] })
      expect(await observed()).toMatchObject([{ repo: 'acme/app', number: 9, branch: 'feat' }])
    })

    it('orders an open pull request ahead of a merged one on the same head', async () => {
      await seedPr(prStateOf({ number: 7, state: 'merged', updatedAt: '2026-11-03T12:00:00.000Z' }))
      await seedPr(prStateOf({ number: 8, state: 'open', updatedAt: '2026-11-02T12:00:00.000Z' }))
      await appendBodies({ harness, epoch, bodies: [branches] })
      expect((await observed()).map((pullRequest) => pullRequest.number)).toEqual([8, 7])
    })

    it('drops a pull request that closed before the session first saw its branch', async () => {
      await seedPr(
        prStateOf({
          number: 6,
          state: 'closed',
          updatedAt: '2026-11-01T12:00:00.000Z',
          closedAt: '2026-11-01T12:00:00.000Z',
        }),
      )
      await seedPr(prStateOf({ number: 7, state: 'open', updatedAt: '2026-11-03T12:00:00.000Z' }))
      await appendBodies({ harness, epoch, bodies: [branches] })
      expect((await observed()).map((pullRequest) => pullRequest.number)).toEqual([7])
    })

    it('tracks a pull request merged after the session first saw its branch', async () => {
      await seedPr(
        prStateOf({
          number: 7,
          state: 'merged',
          updatedAt: '2026-11-03T12:00:00.000Z',
          closedAt: '2026-11-03T12:00:00.000Z',
          mergedAt: '2026-11-03T12:00:00.000Z',
        }),
      )
      await appendBodies({ harness, epoch, bodies: [branches] })
      expect((await observed()).map((pullRequest) => pullRequest.number)).toEqual([7])
    })

    it('lists a subscribed pull request that no worked branch links', async () => {
      await seedPr(prStateOf({ number: 11, state: 'open', updatedAt: '2026-11-03T12:00:00.000Z' }))
      await appendBodies({ harness, epoch, bodies: [said('a')] })
      await subscribe(11)
      expect(await observed()).toMatchObject([{ repo: 'acme/app', number: 11, branch: 'feat' }])
    })

    it('lists a subscribed pull request once beside the branch that links it', async () => {
      await seedPr(prStateOf({ number: 7, state: 'open', updatedAt: '2026-11-02T12:00:00.000Z' }))
      await appendBodies({ harness, epoch, bodies: [branches] })
      await subscribe(7)
      const pulled = await observed()
      expect(pulled.map((pullRequest) => pullRequest.number)).toEqual([7])
      expect(pulled[0]?.branch).toBe('feat')
    })

    it('finds the sessions subscribed to a pull request', async () => {
      await subscribe(11)
      const store = params.makeStore()
      expect(
        await store.transact((tx) =>
          tx.sessionsTrackingPullRequest({ repo: 'acme/app', number: 11 }),
        ),
      ).toEqual([SESSION])
      expect(
        await store.transact((tx) =>
          tx.sessionsTrackingPullRequest({ repo: 'acme/app', number: 12 }),
        ),
      ).toEqual([])
    })
  })
}
