import { describe, expect, it } from 'bun:test'

import type { GithubRepoSummary } from '@dltech/atlas-wire/web'

import { additionalRepoChoices } from '../additional-repo-choices'

const repoNamed = (fullName: string): GithubRepoSummary => ({
  fullName,
  isPrivate: false,
  defaultBranch: 'main',
  pushedAt: null,
})

const repos = ['acme/web', 'acme/api', 'acme/docs'].map(repoNamed)

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
