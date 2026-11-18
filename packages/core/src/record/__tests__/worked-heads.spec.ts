import { describe, expect, it } from 'bun:test'

import type { BranchObservation } from '../branches'
import { workedHeadsOf } from '../worked-heads'

const observation = (overrides: Partial<BranchObservation> = {}): BranchObservation => ({
  repo: '/w',
  head: 'feat-a',
  branches: [
    { name: 'feat-a', sha: 'aaa111', pushRemote: null },
    { name: 'main', sha: 'bbb222', pushRemote: null },
    { name: 'feat-fork', sha: 'ccc333', pushRemote: 'fork' },
  ],
  worktrees: [],
  remotes: [
    { name: 'fork', url: 'https://github.com/dennis/app' },
    { name: 'origin', url: 'git@github.com:acme/app.git' },
  ],
  checkouts: [],
  ...overrides,
})

describe('workedHeadsOf', () => {
  it('maps the checked-out branch through its origin remote', () => {
    expect(workedHeadsOf({ observation: observation(), base: 'main' })).toEqual([
      { headRepo: 'acme/app', branch: 'feat-a' },
    ])
  })

  it('drops the base branch', () => {
    const heads = workedHeadsOf({ observation: observation({ head: 'main' }), base: 'main' })
    expect(heads).toEqual([])
  })

  it('maps a fork branch through its push remote', () => {
    const heads = workedHeadsOf({
      observation: observation({ head: 'feat-fork' }),
      base: 'main',
    })
    expect(heads).toEqual([{ headRepo: 'dennis/app', branch: 'feat-fork' }])
  })

  it('keeps branches the session left behind, in checkout order', () => {
    const heads = workedHeadsOf({
      observation: observation({ checkouts: ['feat-gone', 'feat-a'] }),
      base: 'main',
    })
    expect(heads).toEqual([
      { headRepo: 'acme/app', branch: 'feat-a' },
      { headRepo: 'acme/app', branch: 'feat-gone' },
    ])
  })

  it('keeps worktree branches', () => {
    const heads = workedHeadsOf({
      observation: observation({
        head: null,
        worktrees: [{ path: '/w-x', branch: 'feat-w', sha: 'ddd444', detached: false }],
      }),
      base: 'main',
    })
    expect(heads).toEqual([{ headRepo: 'acme/app', branch: 'feat-w' }])
  })

  it('reads an ssh remote url', () => {
    const heads = workedHeadsOf({
      observation: observation({
        remotes: [{ name: 'origin', url: 'ssh://git@github.com/acme/app.git' }],
      }),
      base: null,
    })
    expect(heads).toEqual([{ headRepo: 'acme/app', branch: 'feat-a' }])
  })

  it('drops a branch whose only remote is not GitHub', () => {
    const heads = workedHeadsOf({
      observation: observation({
        remotes: [{ name: 'origin', url: 'git@gitlab.com:acme/app.git' }],
      }),
      base: null,
    })
    expect(heads).toEqual([])
  })

  it('drops a branch with no remote at all', () => {
    expect(workedHeadsOf({ observation: observation({ remotes: [] }), base: null })).toEqual([])
  })

  it('reads an observation journaled before remotes existed', () => {
    const legacy = observation({
      remotes: undefined,
      checkouts: undefined,
      branches: [
        { name: 'feat-a', sha: 'aaa111' },
        { name: 'main', sha: 'bbb222' },
      ],
    })
    expect(workedHeadsOf({ observation: legacy, base: 'main' })).toEqual([])
  })
})
