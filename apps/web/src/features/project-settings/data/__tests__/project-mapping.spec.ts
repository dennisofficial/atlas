import { describe, expect, it } from 'vitest'

import { ESecretKind, EShipBehavior } from '@dltech/atlas-wire/web'
import type { ListedSecret } from '@/features/settings/data/workspace/resource-api'

import { ESecretScope } from '../../fixtures/project-settings'
import type { ProjectView } from '../project-api'
import {
  identityOf,
  LEGACY_MERGE_LABEL,
  organizationIdOfValue,
  overviewDraftOf,
  PERSONAL_WORKSPACE_LABEL,
  PERSONAL_WORKSPACE_VALUE,
  saveBodyOf,
  shipOptionsOf,
  workspaceOptionsOf,
  workspaceValueOf,
} from '../project-mapping'
import { projectSecretRows } from '../project-secrets'
import { DEFAULT_SIZE_ID, sizeIdOf, vcpusOfSizeId } from '../sandbox-mapping'

const NOW = Date.parse('2026-10-20T12:00:00Z')

const project: ProjectView = {
  id: 'p1',
  name: 'atlas',
  repo: 'dennisofficial/atlas',
  baseBranch: null,
  additionalRepos: [{ repo: 'a/b', branch: 'dev' }],
  description: '',
  shipBehavior: EShipBehavior.OpenPullRequest,
  organizationId: null,
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
    expect(saveBodyOf({ project, draft, includeWorkspace: false })).toEqual({
      name: 'renamed',
      repo: 'dennisofficial/atlas',
      baseBranch: null,
      additionalRepos: [{ repo: 'a/b', branch: 'dev' }, { repo: 'c/d' }],
      description: '',
      shipBehavior: EShipBehavior.OpenPullRequest,
    })
  })
})

describe('ship options', () => {
  it('offers only open pull request and push for a current value', () => {
    const options = shipOptionsOf(EShipBehavior.Push)
    expect(options.map((option) => option.value)).toEqual([
      EShipBehavior.OpenPullRequest,
      EShipBehavior.Push,
    ])
    expect(options.every((option) => !option.disabled)).toBe(true)
  })

  it('keeps a stored merge value as a disabled legacy item instead of dropping it', () => {
    const options = shipOptionsOf(EShipBehavior.Merge)
    const legacy = options.find((option) => option.value === EShipBehavior.Merge)
    expect(legacy).toMatchObject({ label: LEGACY_MERGE_LABEL, disabled: true })
    expect(LEGACY_MERGE_LABEL).toBe('Merge when green (no longer offered)')
    expect(options.filter((option) => !option.disabled)).toHaveLength(2)
  })
})

describe('workspace picker mapping', () => {
  it('maps the personal option to null and back', () => {
    expect(organizationIdOfValue(PERSONAL_WORKSPACE_VALUE)).toBeNull()
    expect(organizationIdOfValue('org-1')).toBe('org-1')
    expect(workspaceValueOf(null)).toBe(PERSONAL_WORKSPACE_VALUE)
    expect(workspaceValueOf('org-1')).toBe('org-1')
  })

  it('lists personal first, then organizations, plus an unknown current workspace', () => {
    const organizations = [{ id: 'org-1', name: 'Acme', slug: 'acme' }]
    expect(workspaceOptionsOf({ organizations, current: null })).toEqual([
      { value: PERSONAL_WORKSPACE_VALUE, label: PERSONAL_WORKSPACE_LABEL },
      { value: 'org-1', label: 'Acme' },
    ])
    expect(workspaceOptionsOf({ organizations, current: 'org-9' }).map((o) => o.value)).toEqual([
      PERSONAL_WORKSPACE_VALUE,
      'org-1',
      'org-9',
    ])
  })

  it('sends organizationId only when the capability is on and the value changed', () => {
    const draft = { ...overviewDraftOf(project), organizationId: 'org-1' }
    expect(saveBodyOf({ project, draft, includeWorkspace: false })).not.toHaveProperty('organizationId')
    expect(saveBodyOf({ project, draft, includeWorkspace: true }).organizationId).toBe('org-1')
    const unchanged = overviewDraftOf(project)
    expect(saveBodyOf({ project, draft: unchanged, includeWorkspace: true })).not.toHaveProperty('organizationId')
    const moved = { ...project, organizationId: 'org-1' }
    const toPersonal = { ...overviewDraftOf(moved), organizationId: null }
    expect(saveBodyOf({ project: moved, draft: toPersonal, includeWorkspace: true }).organizationId).toBeNull()
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
