import { describe, expect, it } from 'bun:test'

import { ESubscriptionActor, ESubscriptionStatus, ESubscriptionTone } from '@dltech/atlas-core'

import { subscriptionRowsOf, withPullRequestDetails, type SubscriptionListRow } from '..'

const rowOf = (overrides: Partial<SubscriptionListRow> = {}): SubscriptionListRow => ({
  id: 's1',
  provider: 'github.pull-request',
  status: ESubscriptionStatus.Active,
  createdBy: ESubscriptionActor.Agent,
  threadId: 't1',
  number: 31,
  held: 0,
  presentation: {
    icon: 'git-pull-request',
    tone: ESubscriptionTone.Open,
    title: 'owner/atlas#31',
    meta: ['Pull request', 'all events'],
  },
  ...overrides,
})

const runRow = (): SubscriptionListRow => ({
  id: 'r1',
  provider: 'github.workflow-run',
  status: ESubscriptionStatus.Active,
  createdBy: ESubscriptionActor.Agent,
  threadId: 't1',
  held: 0,
  presentation: {
    icon: 'circle-play',
    tone: ESubscriptionTone.Running,
    title: 'deploy.yml@main',
    meta: ['Workflow run'],
  },
})

describe('subscriptionRowsOf', () => {
  it('carries the pull request number of a target it can read', () => {
    const rows = subscriptionRowsOf({
      subscriptions: [
        {
          id: 's1',
          provider: 'github.pull-request',
          target: { repo: 'github.com/owner/atlas', number: 31 },
          label: 'owner/atlas#31',
          threadId: 't1',
          createdBy: 'agent',
          status: 'active',
          createdAt: '2026-11-08T10:00:00.000Z',
          held: 0,
          presentation: rowOf().presentation,
        },
      ],
    })
    expect(rows.map((row) => row.number)).toEqual([31])
  })
})

describe('withPullRequestDetails', () => {
  it('titles a matched pull request row with its number and title', () => {
    const [row] = withPullRequestDetails({
      rows: [rowOf()],
      pullRequests: [{ number: 31, title: 'Pluggable sandbox providers', state: 'open' }],
    })
    expect(row?.presentation.title).toBe('#31 Pluggable sandbox providers')
  })

  it('keeps the number alone when the pull request has no title yet', () => {
    const [row] = withPullRequestDetails({
      rows: [rowOf()],
      pullRequests: [{ number: 31, state: 'open' }],
    })
    expect(row?.presentation.title).toBe('#31')
  })

  it('draws the icon and tone of the pull request state', () => {
    const pullRequests = [
      { number: 1, title: 'open', state: 'open' },
      { number: 2, title: 'draft', state: 'draft' },
      { number: 3, title: 'merged', state: 'merged' },
      { number: 4, title: 'closed', state: 'closed' },
    ]
    const rows = withPullRequestDetails({
      rows: pullRequests.map((pullRequest) => rowOf({ number: pullRequest.number })),
      pullRequests,
    })
    expect(rows.map((row) => [row.presentation.icon, row.presentation.tone])).toEqual([
      ['git-pull-request', ESubscriptionTone.Open],
      ['git-pull-request-draft', ESubscriptionTone.Neutral],
      ['git-merge', ESubscriptionTone.Merged],
      ['git-pull-request-closed', ESubscriptionTone.Closed],
    ])
  })

  it('keeps the plugin icon and tone for a state it does not know', () => {
    const [row] = withPullRequestDetails({
      rows: [rowOf()],
      pullRequests: [{ number: 31, title: 'Mystery', state: 'queued' }],
    })
    expect(row?.presentation.icon).toBe('git-pull-request')
    expect(row?.presentation.tone).toBe(ESubscriptionTone.Open)
    expect(row?.presentation.title).toBe('#31 Mystery')
  })

  it('enriches a paused row as well', () => {
    const [row] = withPullRequestDetails({
      rows: [rowOf({ status: ESubscriptionStatus.Paused })],
      pullRequests: [{ number: 31, title: 'Paused work', state: 'merged' }],
    })
    expect(row?.status).toBe(ESubscriptionStatus.Paused)
    expect(row?.presentation.title).toBe('#31 Paused work')
    expect(row?.presentation.tone).toBe(ESubscriptionTone.Merged)
  })

  it('leaves rows of other providers and unmatched numbers untouched', () => {
    const rows = [runRow(), rowOf({ number: 9 })]
    expect(
      withPullRequestDetails({ rows, pullRequests: [{ number: 31, title: 'Other' }] }),
    ).toEqual(rows)
  })

  it('leaves the meta line the plugin presented', () => {
    const [row] = withPullRequestDetails({
      rows: [rowOf()],
      pullRequests: [{ number: 31, title: 'Titled', state: 'merged' }],
    })
    expect(row?.presentation.meta).toEqual(['Pull request', 'all events'])
  })
})
