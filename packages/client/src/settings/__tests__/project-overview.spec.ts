import { describe, expect, it } from 'bun:test'

import { EShipBehavior, type Project } from '@dltech/atlas-wire/web'

import {
  additionalRepositoryProblem,
  addAdditionalRepository,
  canAddAdditionalRepository,
  editAdditionalRepository,
  identityOf,
  LEGACY_MERGE_LABEL,
  overviewDraftIsValid,
  overviewDraftOf,
  overviewDraftsEqual,
  overviewSaveBodyOf,
  pickedAdditionalRepository,
  removeAdditionalRepository,
  shipOptionsOf,
} from '../project-overview'

const project: Project = {
  id: 'p1',
  name: 'atlas',
  repo: 'dennisofficial/atlas',
  baseBranch: null,
  additionalRepos: [{ repo: 'a/b', branch: 'dev' }],
  groupId: null,
  description: '',
  shipBehavior: EShipBehavior.OpenPullRequest,
  createdAt: '',
  updatedAt: '',
}

describe('project identity', () => {
  it('derives owner, name and slug from the repo', () => {
    expect(identityOf(project)).toEqual({
      owner: 'dennisofficial',
      name: 'atlas',
      slug: 'dennisofficial/atlas',
      repo: 'dennisofficial/atlas',
    })
    expect(identityOf({ ...project, repo: null }).slug).toBe('atlas')
  })
})

describe('overview draft', () => {
  it('round-trips the draft into a full save body', () => {
    const draft = {
      ...overviewDraftOf(project),
      name: ' renamed ',
      additionalRepositories: ['a/b', ' ', 'c/d'],
    }
    expect(overviewSaveBodyOf({ project, draft })).toEqual({
      name: 'renamed',
      repo: 'dennisofficial/atlas',
      baseBranch: null,
      additionalRepos: [{ repo: 'a/b', branch: 'dev' }, { repo: 'c/d' }],
      description: '',
      shipBehavior: EShipBehavior.OpenPullRequest,
    })
  })

  it('compares every field of the draft', () => {
    const saved = overviewDraftOf(project)
    expect(overviewDraftsEqual({ left: saved, right: { ...saved } })).toBe(true)
    expect(overviewDraftsEqual({ left: saved, right: { ...saved, baseBranch: 'main' } })).toBe(
      false,
    )
    expect(
      overviewDraftsEqual({
        left: saved,
        right: { ...saved, additionalRepositories: ['a/b', 'c/d'] },
      }),
    ).toBe(false)
  })

  it('rejects a blank name and a malformed additional repository', () => {
    const saved = overviewDraftOf(project)
    expect(overviewDraftIsValid({ draft: saved })).toBe(true)
    expect(overviewDraftIsValid({ draft: { ...saved, name: '  ' } })).toBe(false)
    expect(
      overviewDraftIsValid({ draft: { ...saved, additionalRepositories: ['not a repo'] } }),
    ).toBe(false)
  })
})

describe('additional repositories', () => {
  it('accepts owner/name and leaves a blank row alone', () => {
    expect(additionalRepositoryProblem({ value: 'acme/web' })).toBeNull()
    expect(additionalRepositoryProblem({ value: '   ' })).toBeNull()
    expect(additionalRepositoryProblem({ value: 'https://github.com/acme/web' })).not.toBeNull()
  })

  it('adds, edits and removes a row', () => {
    const one = addAdditionalRepository([])
    expect(one).toEqual([''])
    expect(editAdditionalRepository({ repositories: one, index: 0, value: 'acme/web' })).toEqual([
      'acme/web',
    ])
    expect(
      removeAdditionalRepository({ repositories: ['acme/web', 'acme/api'], index: 0 }),
    ).toEqual(['acme/api'])
  })

  it('applies a picker result only within the repo limit and without duplicates', () => {
    const args = {
      repositories: ['acme/web'],
      mainRepository: 'acme/main',
      index: 1,
      value: 'acme/api',
    }
    expect(pickedAdditionalRepository(args)).toEqual(['acme/web', 'acme/api'])
    expect(pickedAdditionalRepository({ ...args, index: 0 })).toEqual(['acme/api'])
    for (const value of ['ACME/main', 'acme/web', '', 'bad']) {
      expect(pickedAdditionalRepository({ ...args, value })).toEqual(['acme/web'])
    }
    for (const index of [-1, 0.5, 3, Number.NaN]) {
      expect(pickedAdditionalRepository({ ...args, index })).toEqual(['acme/web'])
    }
    const full = Array.from({ length: 10 }, (_, i) => `acme/repo-${String(i)}`)
    expect(pickedAdditionalRepository({ ...args, repositories: full, index: 10 })).toEqual(full)
  })

  it('stops at the wire limit', () => {
    const full = Array.from({ length: 10 }, (_, index) => `acme/repo-${String(index)}`)
    expect(canAddAdditionalRepository({ repositories: full })).toBe(false)
    expect(canAddAdditionalRepository({ repositories: full.slice(0, 9) })).toBe(true)
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
