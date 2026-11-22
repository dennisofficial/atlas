import { describe, expect, it } from 'bun:test'

import { NO_REPO_WORKSPACE_PATH, WORKSPACES_PATH, workspaceDirectoryOf } from '../constants'

describe('workspaceDirectoryOf', () => {
  it('names the directory after the repo of a project with a remote', () => {
    expect(workspaceDirectoryOf({ remoteUrl: 'https://github.com/dltech/comp-neo.git' })).toBe(
      '/atlas/workspaces/comp-neo',
    )
  })

  it('derives the same name from an ssh remote', () => {
    expect(workspaceDirectoryOf({ remoteUrl: 'git@github.com:dltech/comp-neo.git' })).toBe(
      `${WORKSPACES_PATH}/comp-neo`,
    )
  })

  it('keeps the placeholder directory for a project without a repo', () => {
    expect(workspaceDirectoryOf({ remoteUrl: null })).toBe('/atlas/workspaces/workspace')
    expect(NO_REPO_WORKSPACE_PATH).toBe('/atlas/workspaces/workspace')
  })
})
