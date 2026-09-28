import { describe, expect, it } from 'bun:test'

import { EPullRequestLookup, EPullRequestState, EChecksState } from '../../plugins/github/pure'
import type { RepositoryCheckout } from '../../plugins/github/pure'
import type { SubscriptionPrState } from '../pr-subscription-client'
import { createSseSubscriptionBook, readingOfState } from '../sse-pull-request-book'

const state = (over: Partial<SubscriptionPrState> = {}): SubscriptionPrState => ({
  repoFullName: 'owner/repo',
  prNumber: 42,
  title: 'A pull request',
  url: 'https://github.com/owner/repo/pull/42',
  state: 'open',
  headBranch: 'feature',
  headSha: 'abc123',
  checksRunning: 1,
  checksPassed: 2,
  checksFailed: 0,
  mergeable: null,
  updatedAt: '2026-09-28T00:00:00.000Z',
  ...over,
})

const checkout = (over: Partial<RepositoryCheckout['remote']> = {}): RepositoryCheckout => ({
  directory: '/repo',
  branch: 'feature',
  forge: 0 as never,
  remote: { host: 'github.com', owner: 'owner', repo: 'repo', ...over },
})

describe('readingOfState', () => {
  it('maps a cloud state into a Found reading', () => {
    const reading = readingOfState(state())
    expect(reading.lookup).toBe(EPullRequestLookup.Found)
    if (reading.lookup !== EPullRequestLookup.Found) return
    expect(reading.pullRequest.number).toBe(42)
    expect(reading.pullRequest.state).toBe(EPullRequestState.Open)
    expect(reading.pullRequest.checks).toBe(EChecksState.Running)
  })

  it('reads failing checks before running or passing', () => {
    const reading = readingOfState(state({ checksRunning: 1, checksPassed: 3, checksFailed: 1 }))
    if (reading.lookup !== EPullRequestLookup.Found) throw new Error('expected found')
    expect(reading.pullRequest.checks).toBe(EChecksState.Failing)
  })

  it('reads an unknown PR state as retryable Unavailable rather than throwing', () => {
    const reading = readingOfState(state({ state: 'rebased' }))
    expect(reading).toEqual({ lookup: EPullRequestLookup.Unavailable, retryable: true })
  })
})

describe('createSseSubscriptionBook', () => {
  const collect = () => {
    const readings: { key: string; lookup: EPullRequestLookup }[] = []
    return {
      readings,
      onReading: ({ key, reading }: { key: string; reading: { lookup: EPullRequestLookup } }) =>
        readings.push({ key, lookup: reading.lookup }),
    }
  }

  it('answers a repeat subscribe from the held reading without re-emitting', () => {
    const { readings, onReading } = collect()
    const book = createSseSubscriptionBook({ now: () => 0, onReading })

    const first = book.recordSubscribe({
      key: 'k',
      handle: { id: 'sub-1', repoFullName: 'owner/repo' },
      by: { kind: 'branch', branch: 'feature' },
      state: state(),
    })
    expect(first.lookup).toBe(EPullRequestLookup.Found)
    expect(readings).toHaveLength(1)

    const held = book.holding({ key: 'k' })
    expect(held?.handle.id).toBe('sub-1')
    expect(held?.reading.lookup).toBe(EPullRequestLookup.Found)
  })

  it('routes a pushed frame to the entry that subscribed its PR', () => {
    const { readings, onReading } = collect()
    const book = createSseSubscriptionBook({ now: () => 0, onReading })
    book.recordSubscribe({
      key: 'checkout-key',
      handle: { id: 'sub-1', repoFullName: 'owner/repo' },
      by: { kind: 'branch', branch: 'feature' },
      state: state(),
    })

    book.applyFrame({ data: JSON.stringify(state({ checksRunning: 0, checksPassed: 3, checksFailed: 0 })) })

    const last = readings[readings.length - 1]
    expect(last?.key).toBe('checkout-key')
    const held = book.holding({ key: 'checkout-key' })
    if (held?.reading.lookup !== EPullRequestLookup.Found) throw new Error('expected found')
    expect(held.reading.pullRequest.checks).toBe(EChecksState.Passing)
  })

  it('ignores a frame for a PR nobody subscribed', () => {
    const { readings, onReading } = collect()
    const book = createSseSubscriptionBook({ now: () => 0, onReading })
    book.applyFrame({ data: JSON.stringify(state({ prNumber: 99 })) })
    expect(readings).toHaveLength(0)
  })

  it('does not re-emit when a frame restates the shown reading', () => {
    const { readings, onReading } = collect()
    const book = createSseSubscriptionBook({ now: () => 0, onReading })
    book.recordSubscribe({
      key: 'k',
      handle: { id: 'sub-1', repoFullName: 'owner/repo' },
      by: { kind: 'branch', branch: 'feature' },
      state: state(),
    })
    const before = readings.length
    book.applyFrame({ data: JSON.stringify(state()) })
    expect(readings.length).toBe(before)
  })

  it('marks every entry stale on a drop and dead on a refused session', () => {
    const { onReading } = collect()
    const book = createSseSubscriptionBook({ now: () => 0, onReading })
    book.recordSubscribe({
      key: 'k',
      handle: { id: 'sub-1', repoFullName: 'owner/repo' },
      by: { kind: 'branch', branch: 'feature' },
      state: state(),
    })

    book.markAllStale()
    expect(book.holding({ key: 'k' })?.reading).toEqual({
      lookup: EPullRequestLookup.Unavailable,
      retryable: true,
    })

    book.markAllDead()
    expect(book.holding({ key: 'k' })?.reading).toEqual({
      lookup: EPullRequestLookup.Unavailable,
      retryable: false,
    })
  })
})
