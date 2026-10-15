import { describe, expect, it } from 'bun:test'

import type { ActiveWorktree } from '@dltech/atlas-core'

import { workspaceArrivalDrafts } from '../workspace-arrival'
import type { RestoredTree } from '../transfer/manifest'

const ACTIVE: ActiveWorktree = {
  path: '/atlas/workspaces/repo/.atlas/worktrees/thing',
  branch: 'dennis/thing',
  base: undefined,
  adopted: false,
}

describe('workspaceArrivalDrafts', () => {
  it('never emits a location-changed event — a born-cloud arrival is a birth, not a move', () => {
    const drafts = workspaceArrivalDrafts({
      path: '/atlas/workspaces/repo',
      repository: '/atlas/workspaces/repo',
    })

    expect(drafts.some((draft) => draft.type === 'location-changed')).toBe(false)
  })

  it('anchors the restored directory and repository', () => {
    const drafts = workspaceArrivalDrafts({
      path: '/atlas/workspaces/repo',
      repository: '/atlas/workspaces/repo',
    })

    expect(drafts).toContainEqual({
      type: 'directory-changed',
      path: '/atlas/workspaces/repo',
      repo: '/atlas/workspaces/repo',
    })
  })

  it('records the worktree the birth entered', () => {
    const drafts = workspaceArrivalDrafts({
      path: '/atlas/workspaces/repo/.atlas/worktrees/thing',
      repository: '/atlas/workspaces/repo',
      active: ACTIVE,
    })

    expect(drafts).toContainEqual({ type: 'worktree-entered', ...ACTIVE })
  })

  it('adopts a renamed restored tree rather than reusing its original name', () => {
    const renamed: RestoredTree = {
      id: 'main',
      sourcePath: '/host/repo',
      path: '/atlas/workspaces/repo-c0de',
      branch: 'main',
      renamedFrom: '/atlas/workspaces/repo',
    }

    const drafts = workspaceArrivalDrafts({
      path: '/atlas/workspaces/repo-c0de',
      tree: renamed,
      repository: null,
    })

    expect(drafts).toContainEqual({
      type: 'worktree-entered',
      path: '/atlas/workspaces/repo-c0de',
      branch: 'main',
      adopted: true,
    })
  })

  it('appends no context injection — placement rides the ExecutionLocationFragment', () => {
    const drafts = workspaceArrivalDrafts({
      path: '/atlas/workspaces/repo',
      repository: '/atlas/workspaces/repo',
    })

    expect(drafts.some((draft) => draft.type === 'context-loaded')).toBe(false)
  })
})
