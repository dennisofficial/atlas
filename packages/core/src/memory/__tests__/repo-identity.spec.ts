import { describe, expect, it } from 'bun:test'

import { normalizeRepoOrigin } from '../repo-identity'

describe('normalizeRepoOrigin', () => {
  it('normalizes an scp-like ssh remote', () => {
    expect(normalizeRepoOrigin('git@github.com:dennisofficial/atlas.git')).toBe(
      'github.com/dennisofficial/atlas',
    )
  })

  it('normalizes an https remote with a .git suffix', () => {
    expect(normalizeRepoOrigin('https://github.com/dennisofficial/atlas.git')).toBe(
      'github.com/dennisofficial/atlas',
    )
  })

  it('gives one identity to the ssh and https spellings of a remote', () => {
    expect(normalizeRepoOrigin('git@github.com:org/repo.git')).toBe(
      normalizeRepoOrigin('https://github.com/org/repo'),
    )
  })

  it('strips a trailing slash', () => {
    expect(normalizeRepoOrigin('https://github.com/org/repo/')).toBe('github.com/org/repo')
  })

  it('strips userinfo from a token-carrying remote', () => {
    expect(normalizeRepoOrigin('https://x-access-token:abc@github.com/org/repo.git')).toBe(
      'github.com/org/repo',
    )
  })

  it('case-folds the host but keeps the path as written', () => {
    expect(normalizeRepoOrigin('https://GitHub.COM/Org/Repo.git')).toBe('github.com/Org/Repo')
  })

  it('normalizes an explicit ssh url', () => {
    expect(normalizeRepoOrigin('ssh://git@github.com/org/repo.git')).toBe('github.com/org/repo')
  })

  it('keeps a nested group path', () => {
    expect(normalizeRepoOrigin('https://gitlab.com/group/sub/repo.git')).toBe(
      'gitlab.com/group/sub/repo',
    )
  })

  it('names nothing for a local-path remote', () => {
    expect(normalizeRepoOrigin('/Users/dev/code/other')).toBeNull()
    expect(normalizeRepoOrigin('../sibling')).toBeNull()
  })

  it('names nothing for an empty or unreadable remote', () => {
    expect(normalizeRepoOrigin('')).toBeNull()
    expect(normalizeRepoOrigin('   ')).toBeNull()
  })
})
