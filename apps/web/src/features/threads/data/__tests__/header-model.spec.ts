import { describe, expect, it } from 'bun:test'

import { threadOf } from '@/features/shell/__tests__/fixtures'

import {
  EHeaderState,
  STATE_LABEL,
  branchOf,
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

describe('branchOf', () => {
  it('omits the branch when the thread carries no worktree', () => {
    expect(branchOf(threadOf({ id: 't' }))).toBeUndefined()
    expect(branchOf(undefined)).toBeUndefined()
  })

  it('omits an empty branch', () => {
    expect(branchOf(threadOf({ id: 't', worktree: { path: '/w', branch: '' } }))).toBeUndefined()
  })

  it('returns the worktree branch', () => {
    const thread = threadOf({
      id: 't',
      worktree: { path: '/w', branch: 'dennis/x' },
    })
    expect(branchOf(thread)).toBe('dennis/x')
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
