import { describe, expect, it } from 'bun:test'

import { EProjectFileState, projectFilePlanOf } from '../project-files'

const roots = {
  repositoryDir: '/atlas/workspaces/workspace',
  home: '/home/user',
  atlasHome: '/atlas/home',
}

describe('projectFilePlanOf', () => {
  it('plans a repository mount under the launch directory', () => {
    const plan = projectFilePlanOf({
      mounts: [{ path: 'apps/api/.env.keys', contents: 'KEY=1', mode: 0o600 }],
      roots,
    })

    expect(plan.outcomes).toEqual([])
    expect(plan.writes).toEqual([
      {
        path: 'apps/api/.env.keys',
        target: '/atlas/workspaces/workspace/apps/api/.env.keys',
        relativePath: 'apps/api/.env.keys',
        contents: 'KEY=1',
        mode: 0o600,
        repository: true,
        root: '/atlas/workspaces/workspace',
      },
    ])
  })

  it('plans a home mount under the home directory', () => {
    const plan = projectFilePlanOf({
      mounts: [{ path: '~/notes.md', contents: 'x', mode: 0o600 }],
      roots,
    })

    expect(plan.writes[0]?.target).toBe('/home/user/notes.md')
    expect(plan.writes[0]?.repository).toBe(false)
  })

  it('plans an atlas home mount under the atlas home', () => {
    const plan = projectFilePlanOf({
      mounts: [{ path: '@/skills/a.md', contents: 'x', mode: 0o600 }],
      roots,
    })

    expect(plan.writes[0]?.target).toBe('/atlas/home/skills/a.md')
    expect(plan.writes[0]?.relativePath).toBe('skills/a.md')
  })

  it('skips a home mount when the sandbox home is unknown', () => {
    const plan = projectFilePlanOf({
      mounts: [{ path: '~/notes.md', contents: 'x', mode: 0o600 }],
      roots: { ...roots, home: null },
    })

    expect(plan.writes).toEqual([])
    expect(plan.outcomes).toEqual([
      {
        path: '~/notes.md',
        state: EProjectFileState.SkippedNoHome,
        reason: 'the sandbox home is unknown',
      },
    ])
  })

  it('skips repository mounts when there is no repository checkout', () => {
    const plan = projectFilePlanOf({
      mounts: [{ path: 'a.txt', contents: 'x', mode: 0o600 }],
      roots: { ...roots, repositoryDir: null },
    })

    expect(plan.outcomes).toEqual([{ path: 'a.txt', state: EProjectFileState.SkippedNoRepository }])
  })

  it('fails a path that leaves its folder', () => {
    const plan = projectFilePlanOf({
      mounts: [{ path: 'a/../../b.txt', contents: 'x', mode: 0o600 }],
      roots,
    })

    expect(plan.outcomes[0]?.state).toBe(EProjectFileState.Failed)
    expect(plan.writes).toEqual([])
  })
})
