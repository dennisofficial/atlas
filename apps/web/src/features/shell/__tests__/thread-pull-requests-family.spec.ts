import { describe, expect, it } from 'bun:test'

import type { PrStateWire, WireThread } from '@dltech/atlas-wire/web'

import { threadPullRequestsOf } from '../thread-pull-requests'
import { threadOf } from './fixtures'

const pr = (number: number): PrStateWire => ({
  repo: 'acme/atlas',
  number,
  url: `https://github.com/acme/atlas/pull/${number}`,
  branch: 'shared',
  state: 'open',
  checksRunning: 0,
  checksPassed: 2,
  checksFailed: 0,
  mergeable: true,
})

const onBranch = (id: string, overrides: Partial<WireThread> = {}): WireThread =>
  threadOf({
    id,
    repo: 'acme/atlas',
    worktree: { path: `/work/${id}`, branch: 'shared' },
    ...overrides,
  })

const entriesOf = (args: {
  thread: WireThread
  family?: readonly WireThread[]
  states?: readonly PrStateWire[]
}) =>
  threadPullRequestsOf({
    teammates: [],
    collapsed: false,
    states: [pr(1), pr(2)],
    ...args,
  })

const numbersOf = (entries: ReturnType<typeof threadPullRequestsOf>) =>
  entries.map((entry) => entry.number)

describe('family ownership before live branch discovery', () => {
  it('keeps shared-branch root and teammate ownership when expanded and aggregates when collapsed', () => {
    const mate = onBranch('mate', { pullRequests: [pr(2)] })
    const root = onBranch('root', {
      pullRequests: [pr(1), { ...pr(2), via: { threadId: mate.id, title: null } }],
    })
    const family = [root, mate]
    expect(numbersOf(entriesOf({ thread: root, family }))).toEqual([1])
    expect(numbersOf(entriesOf({ thread: mate, family }))).toEqual([2])
    const collapsed = threadPullRequestsOf({
      thread: root,
      teammates: [mate],
      collapsed: true,
      states: [pr(1), pr(2)],
      family,
    })
    expect(numbersOf(collapsed)).toEqual([1, 2])
    expect(collapsed.every((entry) => entry.via === undefined)).toBe(true)
  })

  it('retains shared explicit direct ownership on both rows but counts the PR only once', () => {
    const root = onBranch('root', { pullRequests: [pr(1)] })
    const mate = onBranch('mate', { pullRequests: [pr(1)] })
    const family = [root, mate]
    const states = [pr(1)]
    expect(numbersOf(entriesOf({ thread: root, family, states }))).toEqual([1])
    expect(numbersOf(entriesOf({ thread: mate, family, states }))).toEqual([1])
    expect(
      numbersOf(
        threadPullRequestsOf({
          thread: root,
          teammates: [mate],
          collapsed: true,
          states,
          family,
        }),
      ),
    ).toEqual([1])
  })

  it('uses known via owners even when the owner has no explicit links yet', () => {
    const mate = onBranch('mate')
    const root = onBranch('root', {
      pullRequests: [pr(1), { ...pr(2), via: { threadId: mate.id, title: null } }],
    })
    const family = [root, mate]
    expect(numbersOf(entriesOf({ thread: mate, family }))).toEqual([2])
    expect(numbersOf(entriesOf({ thread: root, family }))).toEqual([1])
  })

  it('does not invent owners for an unknown live PR on an ambiguous shared branch', () => {
    const root = onBranch('root', { pullRequests: [pr(1)] })
    const mate = onBranch('mate', { pullRequests: [pr(2)] })
    const family = [root, mate]
    const states = [pr(1), pr(2), pr(3)]
    expect(numbersOf(entriesOf({ thread: root, family, states }))).toEqual([1])
    expect(numbersOf(entriesOf({ thread: mate, family, states }))).toEqual([2])
  })

  it('uses all nested family owners, including ones outside the current subtree', () => {
    const root = onBranch('root', { pullRequests: [pr(1)] })
    const middle = onBranch('middle', {
      pullRequests: [{ ...pr(2), via: { threadId: 'leaf', title: 'Leaf' } }],
    })
    const leaf = onBranch('leaf', { pullRequests: [pr(2)] })
    const family = [root, middle, leaf]
    expect(numbersOf(entriesOf({ thread: middle, family }))).toEqual([])
    expect(numbersOf(entriesOf({ thread: leaf, family }))).toEqual([2])
    expect(
      numbersOf(
        threadPullRequestsOf({
          thread: middle,
          teammates: [leaf],
          collapsed: true,
          states: [pr(1), pr(2)],
          family,
        }),
      ),
    ).toEqual([2])
  })

  it('prefers direct ownership to conflicting borrowed evidence using normalized identities', () => {
    const root = onBranch('root', { pullRequests: [pr(1)] })
    const mate = onBranch('mate')
    const leaf = onBranch('leaf', {
      pullRequests: [
        {
          ...pr(1),
          repo: 'https://github.com/ACME/ATLAS.git',
          via: { threadId: mate.id, title: null },
        },
      ],
    })
    const family = [root, mate, leaf]
    expect(numbersOf(entriesOf({ thread: mate, family, states: [pr(1)] }))).toEqual([])
    expect(numbersOf(entriesOf({ thread: root, family, states: [pr(1)] }))).toEqual([1])
  })

  it('discovers unknown live PRs only for a unique normalized repo and branch', () => {
    const root = onBranch('root', { repo: 'github.com/ACME/ATLAS' })
    const mate = onBranch('mate', { repo: 'acme/other' })
    const otherBranch = onBranch('other-branch', {
      worktree: { path: '/work/other', branch: 'different' },
    })
    expect(numbersOf(entriesOf({ thread: root, family: [root, root, mate, otherBranch] }))).toEqual(
      [1, 2],
    )
  })

  it('does not discover a known other-owner PR even without an explicit family argument', () => {
    const root = onBranch('root', {
      pullRequests: [{ ...pr(2), via: { threadId: 'mate', title: null } }],
    })
    const mate = onBranch('mate', { pullRequests: [pr(1)] })
    expect(
      numbersOf(
        threadPullRequestsOf({
          thread: root,
          teammates: [mate],
          collapsed: false,
          states: [pr(1), pr(2)],
        }),
      ),
    ).toEqual([])
  })
})
