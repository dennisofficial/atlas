import { describe, expect, it } from 'bun:test'

import { workspaceRepoMap } from '../workspace-repo-map'

describe('workspaceRepoMap', () => {
  it('maps the clone paths to their repo and configured base', () => {
    const map = workspaceRepoMap({
      launchDirectory: '/home/app/workspace',
      workspace: {
        remoteUrl: 'https://github.com/acme/web.git',
        baseBranch: 'develop',
        additionalRepos: [{ repo: 'acme/api', branch: 'trunk' }, { repo: 'acme/docs' }],
        setupScript: '',
      },
    })
    expect(map).toEqual([
      { path: '/home/app/workspace', repo: 'acme/web', base: 'develop' },
      { path: '/home/app/api', repo: 'acme/api', base: 'trunk' },
      { path: '/home/app/docs', repo: 'acme/docs', base: null },
    ])
  })

  it('has no repo and no base for a project without a remote', () => {
    const map = workspaceRepoMap({
      launchDirectory: '/w',
      workspace: { remoteUrl: null, baseBranch: null, additionalRepos: [], setupScript: '' },
    })
    expect(map).toEqual([{ path: '/w', repo: null, base: null }])
  })
})
