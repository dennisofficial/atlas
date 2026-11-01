import { describe, expect, it } from 'bun:test'

import type { PrStateWire, WireThread } from '@dltech/atlas-wire/web'

import { threadOf } from '@/features/shell/__tests__/fixtures'

import { pullRequestEntriesOf, pullRequestKeyOf } from '../pull-request-entries'

const pr = (number: number, repo = 'acme/atlas'): PrStateWire => ({
  repo,
  number,
  url: `https://github.com/${repo}/pull/${number}`,
  branch: 'shared',
  state: 'open',
})

const owner = (id: string, pullRequests: WireThread['pullRequests'] = []): WireThread =>
  threadOf({
    id,
    repo: 'acme/atlas',
    worktree: { path: `/work/${id}`, branch: 'shared' },
    pullRequests,
  })

const states = [pr(1), pr(2)]

describe('pull request entry family evidence', () => {
  it('keeps standalone details discovery compatible when no family information is available', () => {
    const thread = owner('solo', [pr(1)])
    const entries = pullRequestEntriesOf({ thread, states })
    expect(entries.map((entry) => entry.number)).toEqual([1, 2])
    expect(pullRequestEntriesOf({ thread, states, family: [] })).toEqual(entries)
  })

  it('preserves borrowed links without making them own and still overlays live metadata', () => {
    const root = owner('root', [pr(1), { ...pr(2), via: { threadId: 'mate', title: 'Teammate' } }])
    const mate = owner('mate', [pr(2)])
    const entries = pullRequestEntriesOf({
      thread: root,
      family: [root, mate],
      states: [pr(1), { ...pr(2), state: 'merged', checksPassed: 4 }],
    })
    expect(entries[1]).toMatchObject({
      number: 2,
      via: { threadId: mate.id, title: 'Teammate' },
      state: 'merged',
      checksPassed: 4,
    })
  })

  it('keeps explicit direct evidence shared without arbitrarily stripping either owner', () => {
    const root = owner('root', [pr(1)])
    const mate = owner('mate', [pr(1)])
    const family = [root, mate]
    for (const thread of family) {
      const entries = pullRequestEntriesOf({ thread, states, family })
      expect(entries.map((entry) => entry.number)).toEqual([1])
      expect(entries[0]?.via).toBeUndefined()
    }
  })

  it('does not confuse an identical number from a different repository with a known owner', () => {
    const root = owner('root', [pr(1)])
    const mate = { ...owner('mate', [pr(1, 'acme/other')]), repo: 'acme/other' }
    const entries = pullRequestEntriesOf({
      thread: root,
      states: [pr(1), pr(2), pr(1, 'acme/other')],
      family: [root, mate],
    })
    expect(entries.map(pullRequestKeyOf)).toEqual(['acme/atlas#1', 'acme/atlas#2'])
  })

  it('does not select an owner from conflicting borrowed claims on a shared branch', () => {
    const root = owner('root', [{ ...pr(1), via: { threadId: 'mate', title: null } }])
    const middle = owner('middle', [{ ...pr(1), via: { threadId: 'leaf', title: null } }])
    const mate = owner('mate')
    const leaf = owner('leaf')
    const family = [root, middle, mate, leaf]
    expect(pullRequestEntriesOf({ thread: mate, states, family })).toEqual([])
    expect(pullRequestEntriesOf({ thread: leaf, states, family })).toEqual([])
  })
})
