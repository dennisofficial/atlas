import { describe, expect, it } from 'bun:test'

import { subscribedPullRequestsOf } from '..'

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 's1',
  provider: 'github.pull-request',
  target: { repo: 'github.com/owner/atlas', number: 31 },
  label: 'owner/atlas#31',
  threadId: 't1',
  createdBy: 'agent',
  status: 'active',
  createdAt: '2026-11-08T10:00:00.000Z',
  ...overrides,
})

describe('subscribedPullRequestsOf', () => {
  it('is empty when the view has no subscriptions entry', () => {
    expect(subscribedPullRequestsOf({})).toEqual([])
  })

  it('names the number, label and url of each active pull request subscription', () => {
    expect(subscribedPullRequestsOf({ subscriptions: [row()] })).toEqual([
      {
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
