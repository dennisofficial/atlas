import { describe, expect, it } from 'bun:test'

import { EPullRequestStateWire, type PrStateWire } from '@dltech/atlas-wire/web'

import { linkedPullRequestOf } from '@/features/shell/thread-status'
import { threadOf } from '@/features/shell/__tests__/fixtures'

import {
  EHeaderState,
  STATE_LABEL,
  branchOf,
  hasConflicts,
  headerStateOf,
  livePullRequestBadgeOf,
  pullRequestBadgeOf,
  sandboxSettingsHrefOf,
  spawnerIdOf,
} from '../header-model'

const pullRequest = (overrides: { number: number; state?: string }) => ({
  url: `https://github.com/o/r/pull/${overrides.number}`,
  repo: 'o/r',
  branch: 'feat',
  ...overrides,
})

describe('spawnerIdOf', () => {
  it('reads the teammate spawner, never the fork parent', () => {
    const forked = threadOf({ id: 't', parent: { threadId: 'fork-source', forkSeq: 3 } })
    expect(spawnerIdOf(forked)).toBeUndefined()
    const spawned = threadOf({ id: 't', agent: { spawnedBy: 'lead', type: 'explore' } })
    expect(spawnerIdOf(spawned)).toBe('lead')
  })

  it('is undefined while the thread is loading', () => {
    expect(spawnerIdOf(undefined)).toBeUndefined()
  })
})

describe('branchOf', () => {
  it('omits the branch when the thread carries no worktree', () => {
    expect(branchOf(threadOf({ id: 't' }))).toBeUndefined()
    expect(branchOf(undefined)).toBeUndefined()
  })

  it('omits an empty branch', () => {
    expect(branchOf(threadOf({ id: 't', worktree: { path: '/w', branch: '' } }))).toBeUndefined()
  })

  it('returns the worktree branch', () => {
    const thread = threadOf({ id: 't', worktree: { path: '/w', branch: 'dennis/x' } })
    expect(branchOf(thread)).toBe('dennis/x')
  })
})

describe('pullRequestBadgeOf', () => {
  it('omits the badge without pull requests', () => {
    expect(pullRequestBadgeOf(threadOf({ id: 't' }))).toBeUndefined()
    expect(pullRequestBadgeOf(undefined)).toBeUndefined()
  })

  it('picks the same pull request as the sidebar', () => {
    const thread = threadOf({
      id: 't',
      pullRequests: [
        pullRequest({ number: 1, state: 'closed' }),
        pullRequest({ number: 2, state: 'open' }),
      ],
    })
    const badge = pullRequestBadgeOf(thread)
    expect(badge?.url).toBe(linkedPullRequestOf(thread)?.url ?? '')
    expect(badge).toEqual({
      label: '#2',
      stateLabel: 'Open',
      url: 'https://github.com/o/r/pull/2',
    })
  })

  it('leaves the state label off when the pull request has no state', () => {
    const thread = threadOf({ id: 't', pullRequests: [pullRequest({ number: 7 })] })
    expect(pullRequestBadgeOf(thread)?.stateLabel).toBeUndefined()
  })
})

describe('livePullRequestBadgeOf', () => {
  const linked = threadOf({
    id: 't',
    pullRequests: [pullRequest({ number: 2, state: 'open' })],
  })
  const pushed = (over: Partial<PrStateWire> = {}): PrStateWire => ({
    repo: 'o/r',
    number: 2,
    url: 'https://github.com/o/r/pull/2',
    branch: 'feat',
    state: EPullRequestStateWire.Open,
    checksRunning: 1,
    checksPassed: 3,
    checksFailed: 2,
    mergeable: null,
    ...over,
  })

  it('prefers the pushed state and adds a failing-checks label', () => {
    const badge = livePullRequestBadgeOf({
      states: [pushed({ state: EPullRequestStateWire.Draft, mergeable: false })],
      thread: linked,
    })
    expect(badge).toEqual({
      label: '#2',
      stateLabel: 'Draft',
      url: 'https://github.com/o/r/pull/2',
      checksLabel: '✕ 2 failing',
      mergeable: false,
    })
  })

  it('ranks running over passing and leaves the label off when no checks report', () => {
    const running = pushed({ checksFailed: 0 })
    expect(livePullRequestBadgeOf({ states: [running], thread: linked })?.checksLabel).toBe(
      '1 running',
    )
    const passing = pushed({ checksFailed: 0, checksRunning: 0 })
    expect(livePullRequestBadgeOf({ states: [passing], thread: linked })?.checksLabel).toBe(
      '✓ 3 passing',
    )
    const quiet = pushed({ checksFailed: 0, checksRunning: 0, checksPassed: 0, mergeable: true })
    const badge = livePullRequestBadgeOf({ states: [quiet], thread: linked })
    expect(badge?.checksLabel).toBeUndefined()
    expect(badge?.mergeable).toBe(true)
  })

  it('falls back to undefined when the pushed set has no matching repo#number', () => {
    expect(livePullRequestBadgeOf({ states: [pushed({ number: 9 })], thread: linked })).toBe(
      undefined,
    )
    expect(livePullRequestBadgeOf({ states: [pushed({ repo: 'x/y' })], thread: linked })).toBe(
      undefined,
    )
    expect(livePullRequestBadgeOf({ states: [pushed()], thread: threadOf({ id: 't' }) })).toBe(
      undefined,
    )
    expect(livePullRequestBadgeOf({ states: [pushed()], thread: undefined })).toBeUndefined()
  })

  it('flags conflicts only on an open pull request that cannot merge', () => {
    const badgeOf = (over: Partial<PrStateWire>) => {
      const badge = livePullRequestBadgeOf({ states: [pushed(over)], thread: linked })
      if (badge === undefined) throw new Error('expected a live badge')
      return badge
    }
    expect(hasConflicts(badgeOf({ mergeable: false }))).toBe(true)
    expect(hasConflicts(badgeOf({ mergeable: null }))).toBe(false)
    expect(hasConflicts(badgeOf({ mergeable: false, state: EPullRequestStateWire.Draft }))).toBe(
      false,
    )
  })

  it('merged/closed states carry no checks label', () => {
    for (const state of [EPullRequestStateWire.Merged, EPullRequestStateWire.Closed]) {
      const badge = livePullRequestBadgeOf({ states: [pushed({ state })], thread: linked })
      expect(badge?.checksLabel).toBeUndefined()
    }
  })
})

describe('headerStateOf', () => {
  it('lets a failed pod win over a working turn', () => {
    expect(headerStateOf({ failed: true, working: true, waitingOnOperator: true })).toBe(
      EHeaderState.Failed,
    )
  })

  it('reports Running while a turn works and Idle otherwise', () => {
    expect(headerStateOf({ failed: false, working: true, waitingOnOperator: false })).toBe(
      EHeaderState.Running,
    )
    expect(headerStateOf({ failed: false, working: false, waitingOnOperator: false })).toBe(
      EHeaderState.Idle,
    )
  })

  it('reads Needs you while the operator is awaited, even mid-turn', () => {
    const state = headerStateOf({ failed: false, working: true, waitingOnOperator: true })
    expect(state).toBe(EHeaderState.NeedsYou)
    expect(STATE_LABEL[state]).toBe('Needs you')
  })
})

describe('sandboxSettingsHrefOf', () => {
  it('links to the project sandbox settings', () => {
    expect(sandboxSettingsHrefOf({ projectId: 'prj 1' })).toBe('/projects/prj%201/settings/sandbox')
  })

  it('omits the link for a thread without a project', () => {
    expect(sandboxSettingsHrefOf({ projectId: null })).toBeUndefined()
    expect(sandboxSettingsHrefOf(undefined)).toBeUndefined()
  })
})
