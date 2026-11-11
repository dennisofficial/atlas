import { describe, expect, test } from 'bun:test'

import {
  cacheHeadersOf,
  IMMUTABLE_CACHE_CONTROL,
  IMMUTABLE_CDN_CACHE_CONTROL,
  isHashedPath,
  NO_STORE_CACHE_CONTROL,
  REVALIDATE_CACHE_CONTROL,
  REVALIDATE_CDN_CACHE_CONTROL,
} from '../cache-headers'

describe('isHashedPath', () => {
  test('matches an eight-character hash before the extension', () => {
    expect(isHashedPath('assets/index-1a2b3c4d.js')).toBeTrue()
  })

  test('matches a long content hash', () => {
    expect(isHashedPath('assets/index-abcdef0123456789abcdef0123456789.js')).toBeTrue()
  })

  test('rejects a seven-character hash', () => {
    expect(isHashedPath('assets/index-1a2b3c4.js')).toBeFalse()
  })

  test('rejects a filename with no hash', () => {
    expect(isHashedPath('index.html')).toBeFalse()
  })

  test('rejects a hash in the directory name', () => {
    expect(isHashedPath('assets-12345678/index.js')).toBeFalse()
  })

  test('rejects a non-hex hash', () => {
    expect(isHashedPath('assets/index-1a2b3c4z.js')).toBeFalse()
  })
})

describe('cacheHeadersOf', () => {
  test('caches a hashed path for a year, at the browser and the edge', () => {
    expect(cacheHeadersOf({ path: 'assets/index-1a2b3c4d.js', status: 200 })).toEqual({
      'Cache-Control': IMMUTABLE_CACHE_CONTROL,
      'CDN-Cache-Control': IMMUTABLE_CDN_CACHE_CONTROL,
    })
  })

  test('revalidates an unhashed path after 60s, at the browser and the edge', () => {
    expect(cacheHeadersOf({ path: 'index.html', status: 200 })).toEqual({
      'Cache-Control': REVALIDATE_CACHE_CONTROL,
      'CDN-Cache-Control': REVALIDATE_CDN_CACHE_CONTROL,
    })
  })

  test('never caches a 404, even for a hashed path', () => {
    expect(cacheHeadersOf({ path: 'assets/index-1a2b3c4d.js', status: 404 })).toEqual({
      'Cache-Control': NO_STORE_CACHE_CONTROL,
      'CDN-Cache-Control': NO_STORE_CACHE_CONTROL,
    })
  })

  test('never caches a 405', () => {
    expect(cacheHeadersOf({ path: '', status: 405 })).toEqual({
      'Cache-Control': NO_STORE_CACHE_CONTROL,
      'CDN-Cache-Control': NO_STORE_CACHE_CONTROL,
    })
  })
})
