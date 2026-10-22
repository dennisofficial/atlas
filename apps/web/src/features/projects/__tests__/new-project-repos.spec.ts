import { describe, expect, it } from 'bun:test'

import type { GithubRepoSummary } from '@dltech/atlas-wire/web'

import {
  BAD_REPO_INPUT_MESSAGE,
  branchChoices,
  defaultBranchOf,
  ERepoInputKind,
  parseRepoInput,
  repoChoices,
  repoInputError,
} from '../new-project-repos'

const repo = (fullName: string, defaultBranch = 'main'): GithubRepoSummary => ({
  fullName,
  isPrivate: false,
  defaultBranch,
  pushedAt: null,
})

const REPOS = [repo('compai/comp-v3'), repo('compai/comp-v2'), repo('compai/csa', 'master')]

describe('parseRepoInput', () => {
  it('is empty for blank input', () => {
    expect(parseRepoInput('   ').kind).toBe(ERepoInputKind.Empty)
  })

  it.each([
    ['owner/name', 'owner/name'],
    ['https://github.com/vercel/ai', 'vercel/ai'],
    ['https://github.com/vercel/ai.git', 'vercel/ai'],
    ['github.com/vercel/ai/tree/main', 'vercel/ai'],
    ['git@github.com:vercel/ai.git', 'vercel/ai'],
  ])('accepts %s', (raw, expected) => {
    expect(parseRepoInput(raw)).toEqual({ kind: ERepoInputKind.Valid, repo: expected })
  })

  it.each([
    'gitlab.com/acme/widgets',
    'https://bitbucket.org/a/b',
    'just-a-word',
    'a/b/c d',
    'owner/..',
  ])('rejects %s', (raw) => {
    expect(parseRepoInput(raw).kind).toBe(ERepoInputKind.Invalid)
  })
})

describe('repoChoices', () => {
  it('filters the passed-in list by substring', () => {
    expect(repoChoices({ repos: REPOS, query: 'comp-v' })).toEqual([
      'compai/comp-v3',
      'compai/comp-v2',
    ])
  })

  it('lists everything for an empty query', () => {
    expect(repoChoices({ repos: REPOS, query: '' })).toHaveLength(3)
  })

  it('is empty for an empty list', () => {
    expect(repoChoices({ repos: [], query: '' })).toEqual([])
  })

  it('offers a pasted repository that is not in the list', () => {
    expect(repoChoices({ repos: REPOS, query: 'https://github.com/vercel/ai' })).toEqual([
      'vercel/ai',
    ])
  })

  it('resolves a pasted URL to the known repository without duplicating it', () => {
    expect(repoChoices({ repos: REPOS, query: 'https://github.com/compai/csa' })).toEqual([
      'compai/csa',
    ])
  })
})

describe('repoInputError', () => {
  it('explains a non-GitHub input that matched nothing', () => {
    expect(repoInputError({ query: 'gitlab.com/acme/widgets', choices: [] })).toBe(
      BAD_REPO_INPUT_MESSAGE,
    )
  })

  it('stays quiet when there are matches or no input', () => {
    expect(repoInputError({ query: 'csa', choices: ['compai/csa'] })).toBeNull()
    expect(repoInputError({ query: '', choices: [] })).toBeNull()
  })
})

describe('branches', () => {
  it('reads the default branch from the list, case-insensitively', () => {
    expect(defaultBranchOf({ repos: REPOS, repo: 'COMPAI/csa' })).toBe('master')
    expect(defaultBranchOf({ repos: REPOS, repo: 'vercel/ai' })).toBeNull()
  })

  it('drops the default branch from the choices', () => {
    expect(
      branchChoices({ branches: ['main', 'staging', 'release'], defaultBranch: 'main' }),
    ).toEqual(['staging', 'release'])
    expect(branchChoices({ branches: ['main'], defaultBranch: null })).toEqual(['main'])
  })
})
