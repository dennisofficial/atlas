import { describe, expect, it } from 'bun:test'

import { EPullRequestStateWire, type PrStateWire } from '@dltech/atlas-wire/web'

import { threadOf } from '@/features/shell/__tests__/fixtures'

import { pullRequestEntriesOf, pullRequestKeyOf } from '../pull-request-entries'

const stateOf = (repo: string, number = 7): PrStateWire => ({
  repo,
  number,
  url: `https://github.com/${repo}/pull/${number}`,
  branch: 'fix/sidebar',
  state: EPullRequestStateWire.Open,
  checksRunning: 0,
  checksPassed: 3,
  checksFailed: 0,
  mergeable: true,
})

const thread = threadOf({
  id: 't',
  repo: 'o/r',
  worktree: { path: '/w', branch: 'fix/sidebar' },
})
const states = [stateOf('o/r'), stateOf('other/repo')]

const linked = {
  repo: 'github.com/O/R',
  number: 6,
  url: 'https://github.com/o/r/pull/6',
  branch: 'older',
}

describe('unlinked live pull request repository scope', () => {
  it.each([
    'o/r',
    'github.com/O/R',
    'https://github.com/O/R',
    'https://github.com/O/R.git/',
    'https://github.com/O/R.git?ref=main#readme',
    'git@github.com:O/R.git',
    'ssh://git@github.com/O/R.git',
    'ssh://git@GitHub.com/O/R.git',
  ])('discovers only the thread repo for %s, not another repo on the same branch', (repo) => {
    const entries = pullRequestEntriesOf({ thread: { ...thread, repo }, states })
    expect(entries.map((pr) => pr.repo)).toEqual(['o/r'])
  })

  it('does not guess a repo from a common branch when the thread has no repo', () => {
    expect(pullRequestEntriesOf({ thread: { ...thread, repo: null }, states })).toEqual([])
  })

  it('uses an explicitly linked own repo when the thread repo is absent', () => {
    const entries = pullRequestEntriesOf({
      thread: { ...thread, repo: null, pullRequests: [linked] },
      states,
    })
    expect(entries.map((pr) => [pr.repo, pr.number])).toEqual([
      ['github.com/O/R', 6],
      ['o/r', 7],
    ])
  })

  it('does not borrow a teammate repo to discover parent-owned pull requests', () => {
    const entries = pullRequestEntriesOf({
      thread: {
        ...thread,
        repo: null,
        pullRequests: [{ ...linked, via: { threadId: 'mate', title: null } }],
      },
      states,
    })
    expect(entries.map((pr) => pr.number)).toEqual([6])
  })

  it.each(['https://gitlab.com/o/r', 'https://github.com.evil.test/o/r', 'not-a-repo', ''])(
    'does not discover a repo from invalid or non-GitHub input %s',
    (repo) => {
      expect(pullRequestEntriesOf({ thread: { ...thread, repo }, states })).toEqual([])
    },
  )

  it('prefers the explicit thread repo over a different linked repo for discovery', () => {
    const entries = pullRequestEntriesOf({
      thread: { ...thread, repo: 'other/repo', pullRequests: [linked] },
      states,
    })
    expect(entries.map((pr) => [pr.repo, pr.number])).toEqual([
      ['github.com/O/R', 6],
      ['other/repo', 7],
    ])
  })

  it('normalizes GitHub URLs for linked live metadata identity too', () => {
    const entries = pullRequestEntriesOf({
      thread: {
        ...thread,
        pullRequests: [{ ...linked, number: 7, repo: 'https://github.com/O/R.git' }],
      },
      states,
    })
    expect(entries).toHaveLength(1)
    expect(entries[0]?.checksPassed).toBe(3)
    expect(pullRequestKeyOf({ repo: 'https://github.com/O/R.git/', number: 7 })).toBe('o/r#7')
  })
})
