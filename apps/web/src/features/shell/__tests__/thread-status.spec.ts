import { describe, expect, it } from 'bun:test'

import type { WireThread } from '@dltech/atlas-wire/web'

import { EThreadStatus, isUnread, isWorking, threadStatusOf } from '../thread-status'
import { threadOf } from './fixtures'

const pr = (number: number, state?: string) => ({
  number,
  url: `https://github.com/x/y/pull/${number}`,
  repo: 'x/y',
  branch: `b${number}`,
  ...(state === undefined ? {} : { state }),
})

describe('threadStatusOf', () => {
  for (const state of ['open', 'merged', 'closed', undefined]) {
    it(`does not substitute a ${state ?? 'unknown'} PR state for run status`, () => {
      const pullRequests = [
        pr(1, state),
        { ...pr(2, state), via: { threadId: 'mate', title: null } },
      ]
      expect(threadStatusOf(threadOf({ id: 'a', pullRequests }))).toBe(EThreadStatus.Idle)
    })
  }

  it('is idle without status, not parked', () => {
    expect(threadStatusOf(threadOf({ id: 'a' }))).toBe(EThreadStatus.Idle)
    expect(threadStatusOf(threadOf({ id: 'a', pullRequests: [] }))).toBe(EThreadStatus.Idle)
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
    ['completed', { lastOutcome: 'completed' }, EThreadStatus.Idle],
    ['stopped', { lastOutcome: 'stopped' }, EThreadStatus.Idle],
    ['parked', { podState: 'parked' }, EThreadStatus.Parked],
    ['no pod', { podState: 'none' }, EThreadStatus.Idle],
    ['running over parked', { working: true, podState: 'parked' }, EThreadStatus.Running],
    ['awaiting over parked', { awaiting: 'input', podState: 'parked' }, EThreadStatus.Awaiting],
    [
      'failed outcome over parked',
      { lastOutcome: 'failed', podState: 'parked' },
      EThreadStatus.Failed,
    ],
  ]
  for (const [name, status, expected] of cases) {
    it(`${name} beats pull request states`, () => {
      expect(
        threadStatusOf(threadOf({ id: 'a', pullRequests: merged, status: factsOf(status) })),
      ).toBe(expected)
    })
  }

  it('treats a missing status as no facts', () => {
    expect(threadStatusOf(threadOf({ id: 'a', pullRequests: merged }))).toBe(EThreadStatus.Idle)
  })

  it('uses run facts for local runners without mistaking no cloud pod for parked', () => {
    for (const [status, expected] of [
      [factsOf({ podState: 'none' }), EThreadStatus.Idle],
      [factsOf({ podState: 'none', working: true }), EThreadStatus.Running],
      [factsOf({ podState: 'none', awaiting: 'approval' }), EThreadStatus.Awaiting],
      [factsOf({ podState: 'none', lastOutcome: 'failed' }), EThreadStatus.Failed],
    ] as const) {
      expect(threadStatusOf(threadOf({ id: 'local', runner: 'local', status }))).toBe(expected)
    }
    expect(threadStatusOf(threadOf({ id: 'local', runner: 'local' }))).toBe(EThreadStatus.Idle)
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
    [
      'mid-turn output waits for the turn to end',
      false,
      { working: true, lastAssistantSeq: 5, readSeq: 2 },
      false,
    ],
    [
      'a paused turn awaiting you is unread',
      false,
      { awaiting: 'input', lastAssistantSeq: 5, readSeq: 2 },
      true,
    ],
  ]
  for (const [name, active, status, expected] of table) {
    it(name, () => {
      expect(
        isUnread({
          thread: threadOf({ id: 'a', status: factsOf(status) }),
          active,
        }),
      ).toBe(expected)
    })
  }

  it('is read without status', () => {
    expect(isUnread({ thread: threadOf({ id: 'a' }), active: false })).toBe(false)
  })
})

describe('isWorking', () => {
  it('is working while a turn runs, even with an open pull request', () => {
    const thread = threadOf({
      id: 'a',
      pullRequests: [pr(1, 'open')],
      status: factsOf({ working: true }),
    })
    expect(isWorking(thread)).toBe(true)
  })

  it('is not working between turns or without status', () => {
    expect(isWorking(threadOf({ id: 'a', status: factsOf() }))).toBe(false)
    expect(isWorking(threadOf({ id: 'a' }))).toBe(false)
  })
})
