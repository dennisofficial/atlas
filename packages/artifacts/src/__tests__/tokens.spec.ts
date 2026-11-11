import { describe, expect, it } from 'bun:test'

import {
  ARTIFACT_HOST_MAX_LENGTH,
  ArtifactHostError,
  ArtifactSlugError,
  ArtifactTokenError,
  artifactHostOf,
  isValidSlug,
  isValidToken,
  TOKEN_LENGTH,
} from '../tokens'

const PREVIEW_HOST_PATTERN = /^\d{2,5}-[a-z0-9]{10}\.byatlas\.dev$/

describe('isValidToken', () => {
  it('accepts eight lowercase alphanumerics', () => {
    expect(isValidToken('a1b2c3d4')).toBe(true)
    expect(isValidToken('00000000')).toBe(true)
  })

  it.each([
    { name: 'too short', token: 'a1b2c3d' },
    { name: 'too long', token: 'a1b2c3d4e' },
    { name: 'uppercase', token: 'A1B2C3D4' },
    { name: 'a dash', token: 'a1b2c3d-' },
    { name: 'empty', token: '' },
  ])('rejects $name', ({ token }) => {
    expect(isValidToken(token)).toBe(false)
  })

  it('reports the token length the generator must produce', () => {
    expect(TOKEN_LENGTH).toBe(8)
  })
})

describe('isValidSlug', () => {
  it.each(['a', 'site', 'my-site', 'a'.repeat(40), 'a1-b2'])('accepts $slug', (slug) => {
    expect(isValidSlug(slug)).toBe(true)
  })

  it.each([
    { name: 'empty', slug: '' },
    { name: 'too long', slug: 'a'.repeat(41) },
    { name: 'a leading dash', slug: '-site' },
    { name: 'a trailing dash', slug: 'site-' },
    { name: 'uppercase', slug: 'Site' },
    { name: 'an underscore', slug: 'my_site' },
    { name: 'a preview-shaped label', slug: '3000-abcdefghij' },
  ])('rejects $name', ({ slug }) => {
    expect(isValidSlug(slug)).toBe(false)
  })
})

describe('artifactHostOf', () => {
  it('joins token, slug and domain', () => {
    expect(artifactHostOf({ token: 'a1b2c3d4', slug: 'site', domain: 'byatlas.dev' })).toBe(
      'a1b2c3d4-site.byatlas.dev',
    )
  })

  it('never produces a host matching the preview pattern', () => {
    const tokens = ['12345678', '00000000', '3000000a', 'a1b2c3d4']
    const slugs = ['site', 'my-site', '90-abcdefghijk', '0', 'a'.repeat(40)]
    for (const token of tokens) {
      for (const slug of slugs) {
        const host = artifactHostOf({ token, slug, domain: 'byatlas.dev' })
        expect(PREVIEW_HOST_PATTERN.test(host)).toBe(false)
      }
    }
  })

  it('rejects an invalid token', () => {
    expect(() => artifactHostOf({ token: 'short', slug: 'site', domain: 'byatlas.dev' })).toThrow(
      ArtifactTokenError,
    )
  })

  it('rejects an invalid slug', () => {
    expect(() =>
      artifactHostOf({ token: 'a1b2c3d4', slug: 'Site', domain: 'byatlas.dev' }),
    ).toThrow(ArtifactSlugError)
  })

  it('rejects a host longer than the cap', () => {
    expect(() =>
      artifactHostOf({ token: 'a1b2c3d4', slug: 'a'.repeat(40), domain: `${'d'.repeat(30)}.dev` }),
    ).toThrow(ArtifactHostError)
  })

  it('keeps the longest allowed host inside the cap', () => {
    const host = artifactHostOf({
      token: 'a1b2c3d4',
      slug: 'a'.repeat(40),
      domain: 'byatlas.dev',
    })
    expect(host.length).toBeLessThanOrEqual(ARTIFACT_HOST_MAX_LENGTH)
  })
})
