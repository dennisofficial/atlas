import { describe, expect, it } from 'bun:test'

import { CLOUD_WORKSPACE_PATH, CLOUD_WORKSPACES_PATH, cloudWorkspacePath } from '../cloud-paths'

describe('the cloud path a local workspace lands at', () => {
  it('names the primary directory after the local repository', () => {
    expect(cloudWorkspacePath({ sourcePath: '/Users/me/Developer/atlas' })).toBe('/atlas/workspaces/atlas')
  })

  it('ignores trailing separators', () => {
    expect(cloudWorkspacePath({ sourcePath: '/Users/me/atlas///' })).toBe('/atlas/workspaces/atlas')
  })

  it('keeps spaces in the name', () => {
    expect(cloudWorkspacePath({ sourcePath: '/Users/me/My Project' })).toBe('/atlas/workspaces/My Project')
  })

  it('reads windows separators', () => {
    expect(cloudWorkspacePath({ sourcePath: 'C:\\work\\atlas\\' })).toBe('/atlas/workspaces/atlas')
  })

  it('names the primary rather than a linked worktree beneath it', () => {
    const primary = '/Users/me/atlas'
    expect(cloudWorkspacePath({ sourcePath: primary })).toBe('/atlas/workspaces/atlas')
    expect(cloudWorkspacePath({ sourcePath: `${primary}/.atlas/worktrees/feature` })).toBe(
      '/atlas/workspaces/feature',
    )
  })

  it.each(['/', '', '///', '.', '..', '/Users/me/..', '/Users/me/.'])(
    'falls back to the unnamed workspace for %p',
    (sourcePath) => {
      expect(cloudWorkspacePath({ sourcePath })).toBe(CLOUD_WORKSPACE_PATH)
    },
  )

  it('keeps the unnamed workspace under the shared root', () => {
    expect(CLOUD_WORKSPACE_PATH).toBe(`${CLOUD_WORKSPACES_PATH}/workspace`)
  })
})
