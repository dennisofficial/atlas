import { describe, expect, it } from 'bun:test'

import { ESecretKind, EShipBehavior, type Project } from '@dltech/atlas-wire/web'
import type { ListedSecret } from '@/features/settings/data/workspace/resource-api'

import { ESecretScope } from '../../fixtures/project-settings'
import { identityOf, overviewDraftOf, saveBodyOf } from '../project-mapping'
import { projectSecretRows } from '../project-secrets'
import { DEFAULT_SIZE_ID, sizeIdOf, vcpusOfSizeId } from '../sandbox-mapping'

const NOW = Date.parse('2026-10-20T12:00:00Z')

const project: Project = {
  id: 'p1',
  name: 'atlas',
  repo: 'dennisofficial/atlas',
  baseBranch: null,
  additionalRepos: [{ repo: 'a/b', branch: 'dev' }],
  description: '',
  shipBehavior: EShipBehavior.OpenPullRequest,
  createdAt: '',
  updatedAt: '',
}

describe('project mapping', () => {
  it('derives identity from the repo', () => {
    expect(identityOf(project)).toEqual({
      owner: 'dennisofficial',
      name: 'atlas',
      slug: 'dennisofficial/atlas',
      repo: 'dennisofficial/atlas',
    })
    expect(identityOf({ ...project, repo: null }).slug).toBe('atlas')
  })

  it('round-trips the overview draft into a full save body', () => {
    const draft = { ...overviewDraftOf(project), name: ' renamed ', additionalRepositories: ['a/b', ' ', 'c/d'] }
    expect(saveBodyOf({ project, draft })).toEqual({
      name: 'renamed',
      repo: 'dennisofficial/atlas',
      baseBranch: null,
      additionalRepos: [{ repo: 'a/b', branch: 'dev' }, { repo: 'c/d' }],
      description: '',
      shipBehavior: EShipBehavior.OpenPullRequest,
    })
  })
})

describe('sandbox sizes', () => {
  it('maps vcpus to size ids and back', () => {
    expect(sizeIdOf(null)).toBe(DEFAULT_SIZE_ID)
    expect(vcpusOfSizeId(sizeIdOf(4))).toBe(4)
    expect(vcpusOfSizeId(DEFAULT_SIZE_ID)).toBeNull()
  })
})

describe('project secret rows', () => {
  const entry = (name: string): ListedSecret => ({
    name,
    kind: ESecretKind.EnvVar,
    value: 'v',
    createdAt: '',
    updatedAt: '2026-10-20T11:00:00Z',
  })

  it('marks overrides and hides shadowed workspace rows', () => {
    const rows = projectSecretRows({
      project: [entry('A'), entry('B')],
      workspace: [entry('B'), entry('C')],
      now: NOW,
    })
    expect(rows.map((row) => [row.name, row.scope, row.overridesWorkspace ?? false])).toEqual([
      ['A', ESecretScope.Project, false],
      ['B', ESecretScope.Project, true],
      ['C', ESecretScope.Workspace, false],
    ])
  })
})
