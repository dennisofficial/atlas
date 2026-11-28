import { describe, expect, it } from 'bun:test'

import type { GithubRepoSummary } from '@dltech/atlas-wire/web'

import { additionalRepoChoices, repositoryPickerChoices } from '../repositories'

const repoNamed = (fullName: string): GithubRepoSummary => ({
  fullName,
  isPrivate: false,
  defaultBranch: 'main',
  pushedAt: null,
})

const repos = ['acme/web', 'acme/api', 'acme/docs'].map(repoNamed)

describe('repositoryPickerChoices', () => {
  it('excludes taken names even for an exact search and a pasted URL', () => {
    for (const query of ['ACME/web', 'https://github.com/acme/web']) {
      expect(repositoryPickerChoices({ repos, query, taken: ['acme/web'] })).toEqual([])
    }
  })

  it('searches known repositories and accepts other GitHub URLs', () => {
    expect(repositoryPickerChoices({ repos, query: 'ap', taken: [] })).toEqual(['acme/api'])
    expect(
      repositoryPickerChoices({ repos, query: 'https://github.com/other/new', taken: [] }),
    ).toEqual(['other/new'])
  })
})

describe('additionalRepoChoices', () => {
  it('suggests matching repositories', () => {
    expect(additionalRepoChoices({ repos, query: 'ap', taken: [] })).toEqual(['acme/api'])
  })

  it('hides the main repository and ones already added', () => {
    expect(
      additionalRepoChoices({ repos, query: 'acme', taken: ['acme/web', 'ACME/docs'] }),
    ).toEqual(['acme/api'])
  })

  it('keeps the row its own current value', () => {
    expect(additionalRepoChoices({ repos, query: 'acme/api', taken: ['acme/api'] })).toEqual([
      'acme/api',
    ])
  })

  it('offers a pasted GitHub URL as owner/name', () => {
    expect(
      additionalRepoChoices({ repos, query: 'https://github.com/other/thing.git', taken: [] }),
    ).toEqual(['other/thing'])
  })
})
