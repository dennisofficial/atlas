import { describe, expect, it } from 'bun:test'

import { EPullRequestStateWire, type PrStateWire } from '@dltech/atlas-wire/web'

import { threadOf } from '@/features/shell/__tests__/fixtures'

import { pullRequestListOf } from '../pull-request-rows'

const linked = (number: number, branch: string, state: string) => ({
  url: `https://github.com/o/r/pull/${number}`,
  repo: 'o/r',
  number,
  branch,
  state,
})

const thread = threadOf({
  id: 't',
  worktree: { path: '/w', branch: 'b2' },
  pullRequests: [linked(1, 'b1', 'merged'), linked(2, 'b2', 'open')],
})

describe('pullRequestListOf', () => {
  it('is empty without a thread', () => {
    expect(pullRequestListOf({ thread: undefined, states: [] })).toEqual({
      entries: [],
      rows: [],
      pinnedKey: undefined,
    })
  })

  it('lists every entry oldest first and pins the current branch', () => {
    const list = pullRequestListOf({ thread, states: [] })
    expect(list.rows.map((row) => row.label)).toEqual(['#1', '#2'])
    expect(list.pinnedKey).toBe('o/r#2')
    expect(list.rows[0]?.branch).toBe('b1')
  })

  it('tallies checks and flags conflicts from live state', () => {
    const live: PrStateWire = {
      repo: 'o/r',
      number: 2,
      url: 'https://github.com/o/r/pull/2',
      branch: 'b2',
      state: EPullRequestStateWire.Open,
      checksRunning: 0,
      checksPassed: 1,
      checksFailed: 2,
      mergeable: false,
    }
    const row = pullRequestListOf({ thread, states: [live] }).rows[1]
    expect(row?.checks).toEqual({ running: 0, passed: 1, failed: 2 })
    expect(row?.conflicts).toBe(true)
  })

  it('leaves pull requests without live state without checks or conflicts', () => {
    const row = pullRequestListOf({ thread, states: [] }).rows[0]
    expect(row?.checks).toBeUndefined()
    expect(row?.conflicts).toBe(false)
  })
})
