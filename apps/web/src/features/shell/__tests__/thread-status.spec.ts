import { describe, expect, it } from 'bun:test'

import type { WireThread } from '@dltech/atlas-wire/web'

import { EThreadStatus, isUnread, threadStatusOf } from '../thread-status'
import { threadOf } from './fixtures'

const pr = (number: number, state?: string) => ({
  number,
  url: `https://github.com/x/y/pull/${number}`,
  repo: 'x/y',
  branch: `b${number}`,
  ...(state === undefined ? {} : { state }),
})

describe('threadStatusOf', () => {
  it('is idle without pull requests', () => {
    expect(threadStatusOf(threadOf({ id: 'a' }))).toBe(EThreadStatus.Idle)
    expect(threadStatusOf(threadOf({ id: 'a', pullRequests: [] }))).toBe(EThreadStatus.Idle)
  })

  it('is PR open for an open pull request or one with no recorded state', () => {
    expect(threadStatusOf(threadOf({ id: 'a', pullRequests: [pr(1, 'open')] }))).toBe(
      EThreadStatus.PrOpen,
    )
    expect(threadStatusOf(threadOf({ id: 'a', pullRequests: [pr(1)] }))).toBe(EThreadStatus.PrOpen)
  })

  it('is PR open when an open pull request sits beside a merged one', () => {
    expect(
      threadStatusOf(
        threadOf({
          id: 'a',
          pullRequests: [pr(1467, 'merged'), pr(1469, 'open')],
        }),
      ),
    ).toBe(EThreadStatus.PrOpen)
    expect(
      threadStatusOf(threadOf({ id: 'a', pullRequests: [pr(1, 'open'), pr(2, 'merged')] })),
    ).toBe(EThreadStatus.PrOpen)
  })

  it('is PR merged when merged is the only non-closed state', () => {
    expect(
      threadStatusOf(threadOf({ id: 'a', pullRequests: [pr(1, 'closed'), pr(2, 'merged')] })),
    ).toBe(EThreadStatus.PrMerged)
  })

  it('is PR closed when every pull request is closed', () => {
    expect(threadStatusOf(threadOf({ id: 'a', pullRequests: [pr(1, 'closed')] }))).toBe(
      EThreadStatus.PrClosed,
    )
  })
})

const factsOf = (overrides: Partial<NonNullable<WireThread['status']>> = {}) => ({
  working: false,
  awaiting: null,
  lastOutcome: null,
  podState: 'running' as const,
  lastAssistantSeq: 0,
  readSeq: null,
  ...overrides,
})

describe('threadStatusOf with live status', () => {
  const merged = [pr(1, 'merged')]
  const cases: Array<[string, Partial<NonNullable<WireThread['status']>>, EThreadStatus]> = [
    ['awaiting approval', { awaiting: 'approval' }, EThreadStatus.Awaiting],
    ['awaiting input', { awaiting: 'input' }, EThreadStatus.Awaiting],
    ['awaiting over running', { awaiting: 'input', working: true }, EThreadStatus.Awaiting],
    ['running', { working: true }, EThreadStatus.Running],
    ['running over starting', { working: true, podState: 'booting' }, EThreadStatus.Running],
    ['starting', { podState: 'booting' }, EThreadStatus.Starting],
    [
      'starting over failed outcome',
      { podState: 'booting', lastOutcome: 'failed' },
      EThreadStatus.Starting,
    ],
    ['failed pod', { podState: 'failed' }, EThreadStatus.Failed],
    ['failed outcome', { lastOutcome: 'failed' }, EThreadStatus.Failed],
    ['completed falls through to PRs', { lastOutcome: 'completed' }, EThreadStatus.PrMerged],
    ['stopped falls through to PRs', { lastOutcome: 'stopped' }, EThreadStatus.PrMerged],
    ['parked falls through to PRs', { podState: 'parked' }, EThreadStatus.PrMerged],
  ]
  for (const [name, status, expected] of cases) {
    it(`${name} beats pull request states`, () => {
      expect(
        threadStatusOf(threadOf({ id: 'a', pullRequests: merged, status: factsOf(status) })),
      ).toBe(expected)
    })
  }

  it('treats a missing status as no facts', () => {
    expect(threadStatusOf(threadOf({ id: 'a', pullRequests: merged }))).toBe(EThreadStatus.PrMerged)
  })

  it('is idle with quiet facts and no pull requests', () => {
    expect(threadStatusOf(threadOf({ id: 'a', status: factsOf() }))).toBe(EThreadStatus.Idle)
  })
})

describe('isUnread', () => {
  const table: Array<[string, boolean, Partial<NonNullable<WireThread['status']>>, boolean]> = [
    ['active is never unread', true, { lastAssistantSeq: 9, readSeq: 1 }, false],
    ['no marker with output is unread', false, { lastAssistantSeq: 3, readSeq: null }, true],
    ['output past marker is unread', false, { lastAssistantSeq: 5, readSeq: 4 }, true],
    ['equal is read', false, { lastAssistantSeq: 5, readSeq: 5 }, false],
    ['marker ahead is read', false, { lastAssistantSeq: 5, readSeq: 8 }, false],
    ['no output is never unread', false, { lastAssistantSeq: 0, readSeq: null }, false],
  ]
  for (const [name, active, status, expected] of table) {
    it(name, () => {
      expect(isUnread({ thread: threadOf({ id: 'a', status: factsOf(status) }), active })).toBe(
        expected,
      )
    })
  }

  it('is read without status', () => {
    expect(isUnread({ thread: threadOf({ id: 'a' }), active: false })).toBe(false)
  })
})
