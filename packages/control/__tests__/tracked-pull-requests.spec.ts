import { describe, expect, it } from 'bun:test'

import type { PrStateRow, SessionBranchRow, SessionPullRequestRow } from '../src/port'
import { trackedPullRequestsOf } from '../src/tracked-pull-requests'

const stateOf = (patch: Partial<PrStateRow> & { number: number }): PrStateRow => ({
  repo: 'acme/app',
  title: `PR ${patch.number}`,
  state: 'open',
  headSha: 'b2',
  checksRunning: 1,
  checksPassed: 2,
  checksFailed: 0,
  checksExpected: 0,
  mergeable: true,
  updatedAt: '2026-11-02T12:00:00.000Z',
  closedAt: null,
  mergedAt: null,
  headRepoFullName: 'acme/app',
  headBranch: 'feat',
  ...patch,
})

const branchOf = (patch: Partial<SessionBranchRow> = {}): SessionBranchRow => ({
  sessionId: 'session-1',
  headRepo: 'acme/app',
  branch: 'feat',
  firstSeenSeq: 4,
  firstSeenAt: '2026-11-02T12:00:00.000Z',
  ...patch,
})

const subscriptionOf = (
  patch: Partial<SessionPullRequestRow> & { number: number },
): SessionPullRequestRow => ({ sessionId: 'session-1', repo: 'acme/app', ...patch })

const numbers = (rows: { number: number }[]): number[] => rows.map((row) => row.number)

describe('trackedPullRequestsOf', () => {
  it('links a pull request still open when the session first saw its branch', () => {
    const tracked = trackedPullRequestsOf({
      branches: [branchOf()],
      subscriptions: [],
      states: [stateOf({ number: 7 })],
    })
    expect(numbers(tracked)).toEqual([7])
    expect(tracked[0]?.branch).toBe('feat')
  })

  it('carries the count of required checks still waiting', () => {
    const tracked = trackedPullRequestsOf({
      branches: [branchOf()],
      subscriptions: [],
      states: [stateOf({ number: 7, checksExpected: 2 })],
    })
    expect(tracked[0]?.state.checks).toEqual({ running: 1, passed: 2, failed: 0, expected: 2 })
  })

  it('drops a pull request closed before the session first saw its branch', () => {
    const tracked = trackedPullRequestsOf({
      branches: [branchOf()],
      subscriptions: [],
      states: [
        stateOf({ number: 6, state: 'closed', closedAt: '2026-11-01T12:00:00.000Z' }),
        stateOf({ number: 7 }),
      ],
    })
    expect(numbers(tracked)).toEqual([7])
  })

  it('drops a pull request merged before the session first saw its branch', () => {
    const tracked = trackedPullRequestsOf({
      branches: [branchOf()],
      subscriptions: [],
      states: [
        stateOf({
          number: 6,
          state: 'merged',
          closedAt: '2026-11-01T11:00:00.000Z',
          mergedAt: '2026-11-01T11:00:00.000Z',
        }),
      ],
    })
    expect(tracked).toEqual([])
  })

  it('keeps a pull request closed exactly when the branch was first seen', () => {
    const tracked = trackedPullRequestsOf({
      branches: [branchOf()],
      subscriptions: [],
      states: [stateOf({ number: 6, state: 'closed', closedAt: '2026-11-02T12:00:00.000Z' })],
    })
    expect(numbers(tracked)).toEqual([6])
  })

  it('keeps a branch whose first-seen time is unknown', () => {
    const tracked = trackedPullRequestsOf({
      branches: [branchOf({ firstSeenAt: null })],
      subscriptions: [],
      states: [stateOf({ number: 6, state: 'closed', closedAt: '2020-01-01T00:00:00.000Z' })],
    })
    expect(numbers(tracked)).toEqual([6])
  })

  it('links a subscribed pull request with no worked branch', () => {
    const tracked = trackedPullRequestsOf({
      branches: [],
      subscriptions: [subscriptionOf({ number: 11, repo: 'github.com/Acme/App' })],
      states: [stateOf({ number: 11 })],
    })
    expect(tracked).toMatchObject([{ repo: 'acme/app', number: 11, branch: 'feat' }])
  })

  it('leaves the branch empty when the pull request head is unknown', () => {
    const tracked = trackedPullRequestsOf({
      branches: [],
      subscriptions: [subscriptionOf({ number: 11 })],
      states: [stateOf({ number: 11, headBranch: '' })],
    })
    expect(tracked[0]?.branch).toBe('')
  })

  it('drops a subscription whose pull request state was never fetched', () => {
    const tracked = trackedPullRequestsOf({
      branches: [],
      subscriptions: [subscriptionOf({ number: 11 })],
      states: [],
    })
    expect(tracked).toEqual([])
  })

  it('lists one row per pull request when a branch and a subscription both link it', () => {
    const tracked = trackedPullRequestsOf({
      branches: [branchOf()],
      subscriptions: [subscriptionOf({ number: 7 })],
      states: [stateOf({ number: 7 })],
    })
    expect(tracked).toHaveLength(1)
  })

  it('lists the same pull request once per session that tracks it', () => {
    const tracked = trackedPullRequestsOf({
      branches: [branchOf(), branchOf({ sessionId: 'session-2' })],
      subscriptions: [],
      states: [stateOf({ number: 7 })],
    })
    expect(tracked.map((row) => row.sessionId)).toEqual(['session-1', 'session-2'])
  })
})
