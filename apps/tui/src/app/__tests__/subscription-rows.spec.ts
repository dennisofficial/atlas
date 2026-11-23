import { describe, expect, test } from 'bun:test'

import { GITHUB_PROVIDER } from '@dltech/atlas-plugin-github/core'
import type { SessionSubscription } from '@dltech/atlas-protocol'

import type { PullRequestEntry } from '../pull-request'
import { bellCommandOf, subscriptionTo, subscriptionsSectionOf } from '../subscription-rows'

const ENTRY: PullRequestEntry = {
  repo: 'owner/name',
  number: 12,
  url: 'https://github.com/owner/name/pull/12',
  branch: 'feat/x',
  state: 'open',
  checks: null,
  current: true,
}

const subscription = (patch: Partial<SessionSubscription>): SessionSubscription => ({
  id: 'sub-1',
  threadId: 'session-one',
  provider: GITHUB_PROVIDER,
  target: { repo: 'github.com/owner/name', number: 12 },
  label: '',
  events: [],
  createdBy: 'operator',
  createdAt: '2026-11-20T00:00:00.000Z',
  expiresAt: null,
  ...patch,
})

describe('the subscription bell', () => {
  test('a github pull request subscription matches its entry by number', () => {
    expect(
      subscriptionTo({ subscriptions: [subscription({})], repo: 'owner/name', number: 12 })?.id,
    ).toBe('sub-1')
    expect(
      subscriptionTo({ subscriptions: [subscription({})], repo: 'owner/name', number: 99 }),
    ).toBeNull()
  })

  test('the bell offers subscribe then unsubscribe', () => {
    expect(bellCommandOf({ entry: ENTRY, subscription: null })).toEqual({
      name: 'subscribe',
      provider: GITHUB_PROVIDER,
      target: 'owner/name#12',
    })
    expect(bellCommandOf({ entry: ENTRY, subscription: { id: 'sub-1' } })).toEqual({
      name: 'unsubscribe',
      subscriptionId: 'sub-1',
    })
  })

  test('an unknown provider falls back to the neutral presentation', () => {
    const section = subscriptionsSectionOf({
      subscriptions: [subscription({ provider: 'linear', label: 'LIN-1', target: {} })],
      entries: [ENTRY],
      onRemove: () => undefined,
    })
    expect(section?.rows).toHaveLength(1)
    expect(JSON.stringify(section?.rows)).toContain('LIN-1')
  })

  test('no subscriptions draws no section', () => {
    expect(
      subscriptionsSectionOf({ subscriptions: [], entries: [ENTRY], onRemove: () => undefined }),
    ).toBeNull()
  })
})
