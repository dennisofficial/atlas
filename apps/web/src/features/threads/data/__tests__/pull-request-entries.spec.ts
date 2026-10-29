import { describe, expect, it } from 'bun:test'

import { EPullRequestStateWire, type PrStateWire } from '@dltech/atlas-wire/web'

import { threadOf } from '@/features/shell/__tests__/fixtures'

import { pinnedPullRequestOf, pullRequestEntriesOf } from '../pull-request-entries'

const linked = (number: number, branch: string, state?: string) => ({
  number,
  url: `https://github.com/o/r/pull/${number}`,
  repo: 'o/r',
  branch,
  ...(state === undefined ? {} : { state }),
})

const live = (over: Partial<PrStateWire> & { number: number }): PrStateWire => ({
  repo: 'o/r',
  url: `https://github.com/o/r/pull/${over.number}`,
  branch: 'b',
  state: EPullRequestStateWire.Open,
  checksRunning: 0,
  checksPassed: 0,
  checksFailed: 0,
  mergeable: null,
  ...over,
})

const onBranch = (branch: string) => ({ path: '/w', branch })

describe('pullRequestEntriesOf', () => {
  it('lists linked pull requests oldest first', () => {
    const thread = threadOf({
      id: 't',
      pullRequests: [linked(1, 'a'), linked(2, 'b')],
    })
    expect(pullRequestEntriesOf({ thread, states: [] }).map((entry) => entry.number)).toEqual([
      1, 2,
    ])
  })

  it('joins the live state by repo and number, keeping the linked state otherwise', () => {
    const thread = threadOf({
      id: 't',
      pullRequests: [linked(1, 'a', 'open'), linked(2, 'b', 'open')],
    })
    const entries = pullRequestEntriesOf({
      thread,
      states: [
        live({
          number: 2,
          state: EPullRequestStateWire.Merged,
          checksPassed: 4,
        }),
      ],
    })
    expect(entries[0]?.state).toBe('open')
    expect(entries[1]?.state).toBe('merged')
    expect(entries[1]?.checksPassed).toBe(4)
  })

  it('marks the entry on the worktree branch as current', () => {
    const thread = threadOf({
      id: 't',
      worktree: onBranch('b'),
      pullRequests: [linked(1, 'a'), linked(2, 'b')],
    })
    expect(pullRequestEntriesOf({ thread, states: [] }).map((entry) => entry.current)).toEqual([
      false,
      true,
    ])
  })

  it('appends an unlinked live pull request on the current branch', () => {
    const thread = threadOf({
      id: 't',
      worktree: onBranch('c'),
      pullRequests: [linked(1, 'a', 'merged')],
    })
    const entries = pullRequestEntriesOf({
      thread,
      states: [live({ number: 9, branch: 'c' }), live({ number: 10, branch: 'other' })],
    })
    expect(entries.map((entry) => entry.number)).toEqual([1, 9])
    expect(entries[1]?.current).toBe(true)
  })

  it('does not duplicate a linked pull request that is also live on the branch', () => {
    const thread = threadOf({
      id: 't',
      worktree: onBranch('a'),
      pullRequests: [linked(1, 'a')],
    })
    expect(
      pullRequestEntriesOf({
        thread,
        states: [live({ number: 1, branch: 'a' })],
      }),
    ).toHaveLength(1)
  })
})

describe('pinnedPullRequestOf', () => {
  it('pins #1469 open on the current branch over the merged #1467', () => {
    const thread = threadOf({
      id: 't',
      worktree: onBranch('b'),
      pullRequests: [linked(1467, 'a', 'merged'), linked(1469, 'b', 'open')],
    })
    const entries = pullRequestEntriesOf({ thread, states: [] })
    expect(pinnedPullRequestOf(entries)?.number).toBe(1469)
  })

  it('pins the newest entry when no branch is current', () => {
    const thread = threadOf({
      id: 't',
      pullRequests: [linked(1, 'a'), linked(2, 'b')],
    })
    expect(pinnedPullRequestOf(pullRequestEntriesOf({ thread, states: [] }))?.number).toBe(2)
  })

  it('pins nothing without entries', () => {
    expect(pinnedPullRequestOf([])).toBeUndefined()
  })
})
