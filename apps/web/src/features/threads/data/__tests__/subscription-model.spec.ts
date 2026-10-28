import { describe, expect, it } from 'bun:test'

import {
  ESubscriptionActorWire,
  ESubscriptionStatusWire,
  PULL_REQUEST_SUBSCRIPTION_PROVIDER,
  type SubscriptionWire,
  type WireThread,
} from '@dltech/atlas-wire/web'

import {
  detailOf,
  expiryTextOf,
  pullRequestBellOf,
  pullRequestTargetOf,
  subscriptionForPullRequest,
} from '../subscription-model'

const NOW = Date.parse('2026-10-28T12:00:00.000Z')

const row = (over: Partial<SubscriptionWire> = {}): SubscriptionWire => ({
  id: 'sub_1',
  provider: PULL_REQUEST_SUBSCRIPTION_PROVIDER,
  target: { repo: 'github.com/o/r', number: 4 },
  label: 'o/r#4',
  threadId: 'thr_1' as SubscriptionWire['threadId'],
  createdBy: ESubscriptionActorWire.Agent,
  status: ESubscriptionStatusWire.Active,
  createdAt: '2026-10-28T00:00:00.000Z',
  held: 0,
  ...over,
})

const threadWith = (pullRequests: NonNullable<WireThread['pullRequests']>): WireThread =>
  ({ id: 't', pullRequests }) as WireThread

describe('pullRequestTargetOf', () => {
  it('builds the owner/repo#n input from the linked pull request', () => {
    const thread = threadWith([
      { number: 4, url: 'https://github.com/o/r/pull/4', repo: 'github.com/o/r', branch: 'b' },
    ])
    expect(pullRequestTargetOf(thread)).toEqual({
      repo: 'github.com/o/r',
      number: 4,
      input: 'o/r#4',
    })
  })

  it('has no target without a linked pull request', () => {
    expect(pullRequestTargetOf(threadWith([]))).toBeUndefined()
    expect(pullRequestTargetOf(undefined)).toBeUndefined()
  })
})

describe('subscriptionForPullRequest', () => {
  const target = { repo: 'github.com/o/r', number: 4, input: 'o/r#4' }

  it('finds the subscription on that pull request only', () => {
    expect(subscriptionForPullRequest({ subscriptions: [row()], target })?.id).toBe('sub_1')
    expect(
      subscriptionForPullRequest({
        subscriptions: [row({ target: { repo: 'github.com/o/r', number: 5 } })],
        target,
      }),
    ).toBeUndefined()
    expect(
      subscriptionForPullRequest({ subscriptions: [row({ provider: 'other' })], target }),
    ).toBeUndefined()
  })
})

describe('pullRequestBellOf', () => {
  const target = { repo: 'github.com/o/r', number: 4, input: 'o/r#4' }

  it('is absent without a target', () => {
    expect(
      pullRequestBellOf({ target: undefined, subscriptions: [], busy: new Set() }),
    ).toBeUndefined()
  })

  it('watches only while the subscription is active', () => {
    const base = { target, busy: new Set<string>() }
    expect(pullRequestBellOf({ ...base, subscriptions: [] })?.watching).toBe(false)
    expect(pullRequestBellOf({ ...base, subscriptions: [row()] })?.watching).toBe(true)
    expect(
      pullRequestBellOf({
        ...base,
        subscriptions: [row({ status: ESubscriptionStatusWire.Paused })],
      })?.watching,
    ).toBe(false)
  })

  it('is busy while its input or subscription id is in flight', () => {
    expect(pullRequestBellOf({ target, subscriptions: [], busy: new Set(['o/r#4']) })?.busy).toBe(
      true,
    )
    expect(
      pullRequestBellOf({ target, subscriptions: [row()], busy: new Set(['sub_1']) })?.busy,
    ).toBe(true)
  })
})

describe('expiryTextOf', () => {
  const at = (ms: number) => new Date(NOW + ms).toISOString()

  it('reads minutes, hours and days', () => {
    expect(expiryTextOf({ expiresAt: at(5 * 60_000), now: NOW })).toBe('Expires in 5m')
    expect(expiryTextOf({ expiresAt: at(3 * 3_600_000), now: NOW })).toBe('Expires in 3h')
    expect(expiryTextOf({ expiresAt: at(48 * 3_600_000), now: NOW })).toBe('Expires in 2d')
  })

  it('says expired once past and nothing without an expiry', () => {
    expect(expiryTextOf({ expiresAt: at(-1), now: NOW })).toBe('Expired')
    expect(expiryTextOf({ expiresAt: undefined, now: NOW })).toBeNull()
  })
})

describe('detailOf', () => {
  it('joins provider, creator, held count and expiry', () => {
    const subscription = row({
      held: 2,
      createdBy: ESubscriptionActorWire.Operator,
      expiresAt: new Date(NOW + 60 * 60_000).toISOString(),
    })
    expect(detailOf({ subscription, now: NOW })).toBe('Pull request · You · 2 held · Expires in 1h')
  })
})
