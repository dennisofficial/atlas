import { describe, expect, it } from 'bun:test'
import { hasSigningScope, missingScopesOf, scopeSatisfied } from './github-scopes'

describe('github scope implication', () => {
  const held = (...scopes: string[]) => new Set(scopes)

  it.each([
    [['admin:ssh_signing_key'], 'write:ssh_signing_key', true],
    [['admin:ssh_signing_key'], 'read:ssh_signing_key', true],
    [['write:ssh_signing_key'], 'read:ssh_signing_key', true],
    [['write:ssh_signing_key'], 'admin:ssh_signing_key', false],
    [['read:ssh_signing_key'], 'write:ssh_signing_key', false],
    [['admin:other'], 'write:ssh_signing_key', false],
    [['repo'], 'repo', true],
    [['repo'], 'read:org', false],
  ])('held %j wanted %s -> %s', (scopes, wanted, expected) => {
    expect(scopeSatisfied({ held: held(...scopes), wanted })).toBe(expected)
  })

  it('names every requested scope missing from a legacy grant', () => {
    expect(missingScopesOf('repo,read:org,admin:repo_hook')).toEqual(['admin:ssh_signing_key'])
    expect(missingScopesOf('repo read:org admin:repo_hook admin:ssh_signing_key')).toEqual([])
  })

  it('detects the signing scope only when admin is held', () => {
    expect(hasSigningScope('repo admin:ssh_signing_key')).toBe(true)
    expect(hasSigningScope('repo read:org admin:repo_hook')).toBe(false)
    expect(hasSigningScope('repo write:ssh_signing_key')).toBe(false)
  })
})
