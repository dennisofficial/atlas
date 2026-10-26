import { describe, expect, it } from 'bun:test'

import { linkedPullRequestOf } from '@/features/shell/thread-status'
import { threadOf } from '@/features/shell/__tests__/fixtures'

import {
  branchOf,
  EHeaderState,
  STATE_LABEL,
  headerStateOf,
  pullRequestBadgeOf,
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
