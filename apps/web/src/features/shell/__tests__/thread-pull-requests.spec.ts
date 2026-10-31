import { describe, expect, it } from 'bun:test'

import type { PrStateWire, WireThread } from '@dltech/atlas-wire/web'

import { pullRequestKeyOf } from '@/features/threads/data/pull-request-entries'

import { latestThreadPullRequestOf, threadPullRequestsOf } from '../thread-pull-requests'
import { threadOf } from './fixtures'

type LinkedPullRequest = NonNullable<WireThread['pullRequests']>[number]

const pr = (args: Partial<LinkedPullRequest> & { number: number }): LinkedPullRequest => ({
  repo: 'acme/atlas',
  url: `https://github.com/acme/atlas/pull/${args.number}`,
  branch: `fix-${args.number}`,
  state: 'open',
  ...args,
})

const ownOf = (thread: WireThread) =>
  threadPullRequestsOf({ thread, teammates: [], collapsed: false, states: [] })

const family = () => {
  const mate = threadOf({
    id: 'mate',
    pullRequests: [pr({ number: 3 }), pr({ number: 4 }), pr({ number: 5 })],
  })
  const nested = threadOf({ id: 'nested', pullRequests: [pr({ number: 6 })] })
  const thread = threadOf({
    id: 'main',
    pullRequests: [
      pr({ number: 1 }),
      pr({ number: 2 }),
      ...(mate.pullRequests ?? []).map((entry) => ({
        ...entry,
        via: { threadId: mate.id, title: null },
      })),
      pr({ number: 6, via: { threadId: nested.id, title: null } }),
    ],
  })
  return { thread, teammates: [mate, nested], states: [] }
}

describe('threadPullRequestsOf', () => {
  it('shows main 2, teammate 3 and nested teammate 1; closes to 6 and reopens to 2/3/1', () => {
    const args = family()
    const expanded = () => [ownOf(args.thread), ...args.teammates.map(ownOf)]
    expect(expanded().map((entries) => entries.length)).toEqual([2, 3, 1])
    expect(threadPullRequestsOf({ ...args, collapsed: true }).map((entry) => entry.number)).toEqual(
      [1, 2, 3, 4, 5, 6],
    )
    expect(expanded().map((entries) => entries.length)).toEqual([2, 3, 1])
    expect(args.thread.pullRequests).toHaveLength(6)
  })

  it('collects all flattened descendants even when the parent has no borrowed links', () => {
    const { teammates } = family()
    const thread = threadOf({ id: 'main', pullRequests: [pr({ number: 1 }), pr({ number: 2 })] })
    expect(threadPullRequestsOf({ thread, teammates, collapsed: true, states: [] })).toHaveLength(6)
  })

  it('keeps parent-only borrowed PRs visible when collapsed, not as own when expanded', () => {
    const thread = threadOf({
      id: 'main',
      pullRequests: [pr({ number: 1, via: { threadId: 'not-loaded', title: 'Teammate' } })],
    })
    expect(ownOf(thread)).toEqual([])
    const entries = threadPullRequestsOf({ thread, teammates: [], collapsed: true, states: [] })
    expect(entries).toHaveLength(1)
    expect(entries[0]?.via?.threadId).toBe('not-loaded')
  })

  it('deduplicates normalized repo+number across paths but not two repositories with #1', () => {
    const thread = threadOf({
      id: 'main',
      pullRequests: [
        pr({ number: 1 }),
        pr({ number: 1, repo: 'github.com/ACME/ATLAS' }),
        pr({ number: 1, repo: 'acme/other' }),
        pr({ number: 2, via: { threadId: 'mate', title: null } }),
      ],
    })
    const mate = threadOf({ id: 'mate', pullRequests: [pr({ number: 1 }), pr({ number: 2 })] })
    const entries = threadPullRequestsOf({
      thread,
      teammates: [mate, mate, thread],
      collapsed: true,
      states: [],
    })
    expect(entries.map(pullRequestKeyOf)).toEqual(['acme/atlas#1', 'acme/other#1', 'acme/atlas#2'])
    expect(entries[2]?.via).toBeUndefined()
    expect(ownOf(thread)).toHaveLength(2)
  })

  it('uses live state and checks for every owner, including branch-discovered PRs', () => {
    const thread = threadOf({
      id: 'main',
      worktree: { path: '/work/main', branch: 'fix-1' },
      pullRequests: [pr({ number: 1 })],
    })
    const teammate = threadOf({
      id: 'mate',
      repo: 'acme/atlas',
      worktree: { path: '/work/mate', branch: 'fix-2' },
    })
    const states: PrStateWire[] = [
      { ...pr({ number: 1 }), state: 'merged', checksRunning: 0, checksPassed: 3, checksFailed: 0 },
      {
        ...pr({ number: 2 }),
        state: 'open',
        checksRunning: 1,
        checksPassed: 2,
        checksFailed: 0,
        mergeable: false,
      },
    ]
    const args = { thread, teammates: [teammate], collapsed: true }
    const entries = threadPullRequestsOf({ ...args, states })
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ state: 'merged', checksPassed: 3 })
    expect(entries[1]).toMatchObject({ checksRunning: 1, mergeable: false })
    const updated = threadPullRequestsOf({
      ...args,
      states: states.map((state) => ({ ...state, checksRunning: 0, checksFailed: 1 })),
    })
    expect(updated[1]).toMatchObject({ checksRunning: 0, checksFailed: 1 })
  })

  it('returns no invented PRs or checks when data is absent', () => {
    expect(ownOf(threadOf({ id: 'empty' }))).toEqual([])
    expect(
      ownOf(threadOf({ id: 'main', pullRequests: [pr({ number: 1 })] }))[0]?.checksPassed,
    ).toBeUndefined()
  })
})

describe('latestThreadPullRequestOf', () => {
  it('uses the highest number within a repo, not current branch, entry order or PR state', () => {
    const thread = threadOf({
      id: 'main',
      worktree: { path: '/work', branch: 'fix-1' },
      pullRequests: [
        pr({ number: 9, state: 'merged' }),
        pr({ number: 1 }),
        pr({ number: 7, state: 'closed' }),
      ],
    })
    expect(latestThreadPullRequestOf(ownOf(thread))?.number).toBe(9)
  })

  it('compares numbers across normalized spellings of the same repo', () => {
    const entries = ownOf(
      threadOf({
        id: 'main',
        pullRequests: [pr({ number: 1 }), pr({ number: 2, repo: 'github.com/ACME/ATLAS' })],
      }),
    )
    expect(latestThreadPullRequestOf(entries)).toBe(entries[1])
  })

  it('keeps first-repository precedence rather than inventing chronology between repos', () => {
    const entries = ownOf(
      threadOf({
        id: 'main',
        pullRequests: [
          pr({ number: 1 }),
          pr({ number: 900, repo: 'acme/other' }),
          pr({ number: 3 }),
        ],
      }),
    )
    expect(latestThreadPullRequestOf(entries)?.number).toBe(3)
    expect(entries.map((entry) => entry.number)).toEqual([1, 900, 3])
  })

  it('returns undefined without entries', () => {
    expect(latestThreadPullRequestOf([])).toBeUndefined()
  })
})
