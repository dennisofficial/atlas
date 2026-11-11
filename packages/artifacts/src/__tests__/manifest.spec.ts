import { describe, expect, it } from 'bun:test'

import {
  ArtifactManifestError,
  entriesByPath,
  manifestHash,
  parseManifest,
  safeParseManifest,
} from '../manifest'

const digest = 'a'.repeat(64)

const entryOf = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  path: 'index.html',
  tree: 'dist',
  sha256: digest,
  size: 12,
  type: 'text/html; charset=utf-8',
  ...overrides,
})

describe('parseManifest', () => {
  it('accepts both trees in one manifest', () => {
    const entries = parseManifest([
      entryOf({ tree: 'src', path: 'index.html' }),
      entryOf({ tree: 'dist', path: 'index.html' }),
      entryOf({ path: 'assets/app.js' }),
    ])
    expect(entries).toHaveLength(3)
  })

  it('rejects a duplicate path inside one tree', () => {
    expect(() => parseManifest([entryOf(), entryOf()])).toThrow(ArtifactManifestError)
  })

  it.each([
    { name: 'a leading slash', path: '/index.html' },
    { name: 'an escaping segment', path: '../secret' },
    { name: 'an inner escaping segment', path: 'a/../../secret' },
    { name: 'a trailing slash', path: 'assets/' },
    { name: 'an empty path', path: '' },
    { name: 'a backslash', path: 'a\\b.js' },
    { name: 'a NUL', path: 'a\u0000b' },
  ])('rejects $name', ({ path }) => {
    expect(() => parseManifest([entryOf({ path })])).toThrow(ArtifactManifestError)
  })

  it.each([
    { name: 'an uppercase digest', patch: { sha256: 'A'.repeat(64) } },
    { name: 'a short digest', patch: { sha256: 'abc' } },
    { name: 'a negative size', patch: { size: -1 } },
    { name: 'a fractional size', patch: { size: 1.5 } },
    { name: 'an unknown tree', patch: { tree: 'build' } },
    { name: 'an empty type', patch: { type: '' } },
    { name: 'a missing type', patch: { type: undefined } },
  ])('rejects $name', ({ patch }) => {
    expect(() => parseManifest([entryOf(patch)])).toThrow(ArtifactManifestError)
  })

  it('rejects a payload that is not an array', () => {
    expect(() => parseManifest({ entries: [] })).toThrow(ArtifactManifestError)
  })
})

describe('safeParseManifest', () => {
  it('returns the entries of a valid manifest', () => {
    const result = safeParseManifest([entryOf({ tree: 'src' }), entryOf()])
    expect(result).toEqual({
      ok: true,
      entries: [
        expect.objectContaining({ path: 'index.html', tree: 'src' }),
        expect.objectContaining({ path: 'index.html', tree: 'dist' }),
      ],
    })
  })

  it.each([
    { name: 'a duplicate path', raw: [entryOf(), entryOf()] },
    { name: 'a payload that is not an array', raw: { entries: [] } },
    { name: 'an escaping path', raw: [entryOf({ path: '../secret' })] },
    { name: 'a bad digest', raw: [entryOf({ sha256: 'nope' })] },
    { name: 'a missing payload', raw: undefined },
  ])('answers not ok for $name instead of throwing', ({ raw }) => {
    expect(safeParseManifest(raw)).toEqual({ ok: false })
  })
})

describe('manifestHash', () => {
  it('ignores entry order', () => {
    const entries = parseManifest([
      entryOf({ path: 'a.js' }),
      entryOf({ path: 'b.js' }),
      entryOf({ path: 'c.js', tree: 'src' }),
    ])
    expect(manifestHash(entries)).toBe(manifestHash([...entries].reverse()))
  })

  it('changes when a file changes', () => {
    const left = parseManifest([entryOf({ path: 'a.js', sha256: 'b'.repeat(64) })])
    const right = parseManifest([entryOf({ path: 'a.js', sha256: 'c'.repeat(64) })])
    expect(manifestHash(left)).not.toBe(manifestHash(right))
  })
})

describe('entriesByPath', () => {
  it('filters one tree', () => {
    const entries = parseManifest([
      entryOf({ tree: 'src', path: 'index.html' }),
      entryOf({ tree: 'dist', path: 'index.html' }),
      entryOf({ path: 'app.js' }),
    ])
    expect([...entriesByPath(entries, 'dist').keys()]).toEqual(['index.html', 'app.js'])
    expect([...entriesByPath(entries, 'src').keys()]).toEqual(['index.html'])
  })
})
