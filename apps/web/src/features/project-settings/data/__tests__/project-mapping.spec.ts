import { describe, expect, it } from 'bun:test'

import { EShipBehavior } from '@dltech/atlas-wire/web'
import type { ListedSecret } from '@/features/settings/data/shared/resource-api'

import type { ProjectView } from '../project-api'
import {
  identityOf,
  LEGACY_MERGE_LABEL,
  overviewDraftOf,
  saveBodyOf,
  shipOptionsOf,
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
    const draft = {
      ...overviewDraftOf(project),
      name: ' renamed ',
      additionalRepositories: ['a/b', ' ', 'c/d'],
    }
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

describe('sandbox sizes', () => {
  it('maps vcpus to size ids and back', () => {
    expect(sizeIdOf(null)).toBe(DEFAULT_SIZE_ID)
    expect(vcpusOfSizeId(sizeIdOf(4))).toBe(4)
    expect(vcpusOfSizeId(DEFAULT_SIZE_ID)).toBeNull()
  })
})

describe('project secret rows', () => {
  it('maps project secrets to rows', () => {
    const secret: ListedSecret = {
      name: 'A',
      createdAt: '',
      updatedAt: '2026-10-20T11:00:00Z',
    }
    expect(projectSecretRows({ secrets: [secret], now: NOW })).toEqual([
      { name: 'A', updated: '1h ago' },
    ])
  })
})
