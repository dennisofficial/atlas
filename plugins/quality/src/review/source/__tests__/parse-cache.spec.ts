import { EQualityLanguage } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { createQualityParseCache, type QualityParseBody } from '../parse-cache'

const body = (label: string): QualityParseBody => ({
  language: EQualityLanguage.TypeScript,
  declarations: [],
  evidenceLabels: [label],
  importStatements: [],
  structuralHashes: {},
  invalidSyntax: false,
})

describe('createQualityParseCache', () => {
  it('returns a written body and counts the hit', () => {
    const cache = createQualityParseCache({ maxEntries: 4, maxBytes: 100 })
    cache.write({ key: 'a', bytes: 10, body: body('a') })

    expect(cache.read('a')?.evidenceLabels).toEqual(['a'])
    expect(cache.stats()).toEqual({ entries: 1, bytes: 10, hits: 1, misses: 0 })
  })

  it('counts a miss for an unknown key', () => {
    const cache = createQualityParseCache({ maxEntries: 4, maxBytes: 100 })

    expect(cache.read('missing')).toBeNull()
    expect(cache.stats()).toEqual({ entries: 0, bytes: 0, hits: 0, misses: 1 })
  })

  it('evicts the least recently read entry when the entry bound is passed', () => {
    const cache = createQualityParseCache({ maxEntries: 2, maxBytes: 100 })
    cache.write({ key: 'a', bytes: 1, body: body('a') })
    cache.write({ key: 'b', bytes: 1, body: body('b') })
    cache.read('a')
    cache.write({ key: 'c', bytes: 1, body: body('c') })

    expect(cache.read('a')?.evidenceLabels).toEqual(['a'])
    expect(cache.read('b')).toBeNull()
    expect(cache.read('c')?.evidenceLabels).toEqual(['c'])
    expect(cache.stats().entries).toBe(2)
  })

  it('evicts entries when the byte bound is passed', () => {
    const cache = createQualityParseCache({ maxEntries: 8, maxBytes: 12 })
    cache.write({ key: 'a', bytes: 8, body: body('a') })
    cache.write({ key: 'b', bytes: 8, body: body('b') })

    expect(cache.read('a')).toBeNull()
    expect(cache.stats()).toEqual({ entries: 1, bytes: 8, hits: 0, misses: 1 })
  })

  it('never holds a body larger than the byte bound', () => {
    const cache = createQualityParseCache({ maxEntries: 8, maxBytes: 4 })
    cache.write({ key: 'a', bytes: 5, body: body('a') })

    expect(cache.read('a')).toBeNull()
    expect(cache.stats()).toEqual({ entries: 0, bytes: 0, hits: 0, misses: 1 })
  })

  it('replaces a body under the same key and keeps the byte total right', () => {
    const cache = createQualityParseCache({ maxEntries: 8, maxBytes: 100 })
    cache.write({ key: 'a', bytes: 10, body: body('first') })
    cache.write({ key: 'a', bytes: 4, body: body('second') })

    expect(cache.read('a')?.evidenceLabels).toEqual(['second'])
    expect(cache.stats()).toEqual({ entries: 1, bytes: 4, hits: 1, misses: 0 })
  })

  it('clears entries and counters', () => {
    const cache = createQualityParseCache({ maxEntries: 4, maxBytes: 100 })
    cache.write({ key: 'a', bytes: 10, body: body('a') })
    cache.read('a')
    cache.clear()

    expect(cache.read('a')).toBeNull()
    expect(cache.stats()).toEqual({ entries: 0, bytes: 0, hits: 0, misses: 1 })
  })
})
