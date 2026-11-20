import { describe, expect, it } from 'bun:test'

import { ESubscriptionActor, ESubscriptionStatus, ESubscriptionTone } from '@dltech/atlas-core'

import { subscriptionRowsOf, subscribedPullRequestsOf } from '..'

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 's1',
  provider: 'github.pull-request',
  target: { repo: 'github.com/owner/atlas', number: 31 },
  label: 'owner/atlas#31',
  threadId: 't1',
  createdBy: 'agent',
  status: 'active',
  createdAt: '2026-11-08T10:00:00.000Z',
  held: 0,
  presentation: {
    icon: 'git-pull-request',
    tone: ESubscriptionTone.Open,
    title: 'owner/atlas#31',
    meta: ['Pull request', 'all events'],
  },
  ...overrides,
})

const run = () => ({
  id: 'r1',
  provider: 'github.workflow-run',
  target: {
    kind: 'selector',
    repo: 'github.com/owner/atlas',
    workflow: 'deploy.yml',
    branch: 'main',
  },
  label: 'owner/atlas deploy.yml@main',
  threadId: 't1',
  createdBy: 'agent',
  status: 'active',
  expiresAt: '2026-11-08T12:00:00.000Z',
  createdAt: '2026-11-08T10:00:00.000Z',
  held: 0,
  presentation: {
    icon: 'circle-play',
    tone: ESubscriptionTone.Running,
    title: 'deploy.yml@main',
    meta: ['Workflow run'],
  },
})

describe('subscribedPullRequestsOf', () => {
  it('is empty when the view has no subscriptions entry', () => {
    expect(subscribedPullRequestsOf({})).toEqual([])
  })

  it('names the number, label and url of each active pull request subscription', () => {
    expect(subscribedPullRequestsOf({ subscriptions: [row()] })).toEqual([
      {
        id: 's1',
        number: 31,
        label: 'owner/atlas#31',
        url: 'https://github.com/owner/atlas/pull/31',
      },
    ])
  })

  it('skips paused rows, other providers and targets it cannot read', () => {
    const views = {
      subscriptions: [
        row({ status: 'paused' }),
        row({ provider: 'slack.channel' }),
        row({ target: { channel: 'x' } }),
      ],
    }
    expect(subscribedPullRequestsOf(views)).toEqual([])
  })
})

describe('subscriptionRowsOf', () => {
  it('is empty when the view has no subscriptions entry', () => {
    expect(subscriptionRowsOf({})).toEqual([])
  })

  it('lists every provider and both statuses with the presentation the plugin gave', () => {
    const rows = subscriptionRowsOf({
      subscriptions: [row(), row({ id: 's2', status: 'paused' }), run()],
    })
    expect(rows.map((entry) => [entry.id, entry.status])).toEqual([
      ['s1', ESubscriptionStatus.Active],
      ['s2', ESubscriptionStatus.Paused],
      ['r1', ESubscriptionStatus.Active],
    ])
    expect(rows[2]).toEqual({
      id: 'r1',
      provider: 'github.workflow-run',
      status: ESubscriptionStatus.Active,
      createdBy: ESubscriptionActor.Agent,
      threadId: 't1',
      expiresAt: '2026-11-08T12:00:00.000Z',
      held: 0,
      presentation: run().presentation,
    })
    expect(rows[0]?.presentation).toEqual(row().presentation)
  })
})
