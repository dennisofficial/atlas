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
  it('treats a host-prefixed linked repo and a bare api repo as one pull request', () => {
    const thread = threadOf({
      id: 't',
      worktree: onBranch('b'),
      pullRequests: [{ ...linked(7, 'b', 'open'), repo: 'github.com/o/r' }],
    })
    const entries = pullRequestEntriesOf({
      thread,
      states: [live({ number: 7, checksPassed: 6 })],
    })
    expect(entries).toHaveLength(1)
    expect(entries[0]?.checksPassed).toBe(6)
  })

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

  it('keeps persisted metadata before live state arrives', () => {
    const thread = threadOf({
      id: 't',
      pullRequests: [
        {
          ...linked(7, 'b', 'draft'),
          title: 'Persisted PR title',
          checksRunning: 2,
          checksPassed: 3,
          checksFailed: 1,
          mergeable: false,
        },
      ],
    })
    expect(pullRequestEntriesOf({ thread, states: [] })[0]).toMatchObject({
      title: 'Persisted PR title',
      state: 'draft',
      checksRunning: 2,
      checksPassed: 3,
      checksFailed: 1,
      mergeable: false,
    })
  })

  it('lets live zero check counts and unknown mergeability replace persisted values', () => {
    const thread = threadOf({
      id: 't',
      pullRequests: [
        {
          ...linked(7, 'b', 'draft'),
          title: 'Persisted PR title',
          checksRunning: 2,
          checksPassed: 3,
          checksFailed: 1,
          mergeable: false,
        },
      ],
    })
    const entries = pullRequestEntriesOf({
      thread,
      states: [live({ number: 7, checksPassed: 6 })],
    })
    expect(entries[0]).toMatchObject({
      title: 'Persisted PR title',
      state: 'open',
      checksRunning: 0,
      checksPassed: 6,
      checksFailed: 0,
      mergeable: null,
    })
  })

  it('replaces a stale persisted title with the available live title', () => {
    const thread = threadOf({
      id: 't',
      pullRequests: [{ ...linked(7, 'b'), title: 'Old title' }],
    })
    const entries = pullRequestEntriesOf({
      thread,
      states: [live({ number: 7, title: 'Updated title' })],
    })
    expect(entries[0]?.title).toBe('Updated title')
  })

  it('leaves absent metadata unknown rather than passing', () => {
    const thread = threadOf({ id: 't', pullRequests: [linked(7, 'b')] })
    const [entry] = pullRequestEntriesOf({ thread, states: [] })
    expect(entry?.title).toBeUndefined()
    expect(entry?.state).toBeUndefined()
    expect(entry?.checksRunning).toBeUndefined()
    expect(entry?.checksPassed).toBeUndefined()
    expect(entry?.checksFailed).toBeUndefined()
    expect(entry?.mergeable).toBeUndefined()
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

describe('teammate pull requests', () => {
  const mate = { threadId: 'mate', title: 'fix it' }

  it('carries via onto the entry', () => {
    const thread = threadOf({
      id: 't',
      pullRequests: [linked(1, 'a'), { ...linked(2, 'b'), via: mate }],
    })
    const entries = pullRequestEntriesOf({ thread, states: [] })
    expect(entries[0]?.via).toBeUndefined()
    expect(entries[1]?.via).toEqual(mate)
  })

  it('pins the last own pull request over a newer teammate one', () => {
    const thread = threadOf({
      id: 't',
      pullRequests: [linked(1, 'a'), linked(2, 'b'), { ...linked(3, 'c'), via: mate }],
    })
    expect(pinnedPullRequestOf(pullRequestEntriesOf({ thread, states: [] }))?.number).toBe(2)
  })

  it('pins the last entry when every pull request is a teammate one', () => {
    const thread = threadOf({
      id: 't',
      pullRequests: [
        { ...linked(1, 'a'), via: mate },
        { ...linked(2, 'b'), via: mate },
      ],
    })
    expect(pinnedPullRequestOf(pullRequestEntriesOf({ thread, states: [] }))?.number).toBe(2)
  })
})

describe('pull request discovery follows the checkout', () => {
  it('discovers by the observed checkout branch, not the worktree branch', () => {
    const thread = threadOf({
      id: 't',
      repo: 'o/r',
      worktree: onBranch('old'),
      checkout: { path: '/w', branch: 'switched', detached: false },
    })
    const entries = pullRequestEntriesOf({
      thread,
      states: [live({ number: 1, branch: 'old' }), live({ number: 2, branch: 'switched' })],
    })
    expect(entries.map((entry) => entry.number)).toEqual([2])
  })
})
