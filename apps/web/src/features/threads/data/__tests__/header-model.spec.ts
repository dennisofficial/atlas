import { describe, expect, it } from 'bun:test'

import { threadOf } from '@/features/shell/__tests__/fixtures'

import {
  EHeaderState,
  STATE_LABEL,
  currentBranchOf,
  headerStateOf,
  sandboxSettingsHrefOf,
  spawnerIdOf,
} from '../header-model'

describe('spawnerIdOf', () => {
  it('reads the teammate spawner, never the fork parent', () => {
    const forked = threadOf({
      id: 't',
      parent: { threadId: 'fork-source', forkSeq: 3 },
    })
    expect(spawnerIdOf(forked)).toBeUndefined()
    const spawned = threadOf({
      id: 't',
      agent: { spawnedBy: 'lead', type: 'explore' },
    })
    expect(spawnerIdOf(spawned)).toBe('lead')
  })

  it('is undefined while the thread is loading', () => {
    expect(spawnerIdOf(undefined)).toBeUndefined()
  })
})

describe('currentBranchOf', () => {
  it('omits the branch when the thread carries neither checkout nor worktree', () => {
    expect(currentBranchOf(threadOf({ id: 't' }))).toBeUndefined()
    expect(currentBranchOf(undefined)).toBeUndefined()
  })

  it('omits an empty worktree branch', () => {
    expect(
      currentBranchOf(threadOf({ id: 't', worktree: { path: '/w', branch: '' } })),
    ).toBeUndefined()
  })

  it('falls back to the worktree branch while no checkout is observed', () => {
    const thread = threadOf({ id: 't', worktree: { path: '/w', branch: 'dennis/x' } })
    expect(currentBranchOf(thread)).toBe('dennis/x')
  })

  it('prefers the observed checkout branch over the worktree branch', () => {
    const thread = threadOf({
      id: 't',
      worktree: { path: '/w', branch: 'dennis/x' },
      checkout: { path: '/w', branch: 'switched', detached: false },
    })
    expect(currentBranchOf(thread)).toBe('switched')
  })

  it('reports a detached head', () => {
    const thread = threadOf({
      id: 't',
      worktree: { path: '/w', branch: 'dennis/x' },
      checkout: { path: '/w', branch: null, detached: true },
    })
    expect(currentBranchOf(thread)).toBe('detached')
  })

  it('shows nothing for a non-git directory instead of a stale worktree branch', () => {
    const thread = threadOf({
      id: 't',
      worktree: { path: '/w', branch: 'dennis/x' },
      checkout: { path: '/tmp', branch: null, detached: false },
    })
    expect(currentBranchOf(thread)).toBeUndefined()
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
    expect(
      headerStateOf({
        failed: false,
        working: false,
        waitingOnOperator: false,
      }),
    ).toBe(EHeaderState.Idle)
  })

  it('reads Needs you while the operator is awaited, even mid-turn', () => {
    const state = headerStateOf({
      failed: false,
      working: true,
      waitingOnOperator: true,
    })
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
