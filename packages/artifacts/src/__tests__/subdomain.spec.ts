import { describe, expect, it } from 'bun:test'

import {
  ArtifactSubdomainError,
  assertSubdomain,
  isSubdomain,
  subdomainOfBytes,
  subdomainOfLabel,
  subdomainSchema,
  SUBDOMAIN_LENGTH,
} from '../subdomain'

describe('subdomainSchema', () => {
  it.each(['k7f2m9qxabcd', 'a', 'a-b', '0abc123def45'])('accepts %p', (value) => {
    expect(subdomainSchema.safeParse(value).success).toBe(true)
  })

  it.each(['', '-lead', 'trail-', 'Upper', 'under_score', 'dot.dot', 'a'.repeat(64)])(
    'rejects %p',
    (value) => {
      expect(subdomainSchema.safeParse(value).success).toBe(false)
      expect(isSubdomain(value)).toBe(false)
    },
  )
})

describe('assertSubdomain', () => {
  it('returns a valid label', () => {
    expect(assertSubdomain('k7f2m9qxabcd')).toBe('k7f2m9qxabcd')
  })

  it('throws on a label a host could not carry', () => {
    expect(() => assertSubdomain('Not A Label')).toThrow(ArtifactSubdomainError)
  })
})

describe('subdomainOfBytes', () => {
  it('writes lowercase base32 of a fixed length', () => {
    const value = subdomainOfBytes(new Uint8Array(SUBDOMAIN_LENGTH).map((_, index) => index))

    expect(value).toHaveLength(SUBDOMAIN_LENGTH)
    expect(isSubdomain(value)).toBe(true)
    expect(value).toBe('abcdefghijkl')
  })

  it('never produces an empty label', () => {
    expect(isSubdomain(subdomainOfBytes(new Uint8Array()))).toBe(true)
  })
})

describe('subdomainOfLabel', () => {
  it('lowercases the host label', () => {
    expect(subdomainOfLabel('K7F2M9QXABCD')).toBe('k7f2m9qxabcd')
  })

  it('rejects a label that is not hostname-safe', () => {
    expect(subdomainOfLabel('3000-abc123def4.example')).toBeNull()
    expect(subdomainOfLabel('')).toBeNull()
    expect(subdomainOfLabel('-abc')).toBeNull()
  })
})
