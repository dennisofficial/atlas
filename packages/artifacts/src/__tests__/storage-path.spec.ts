import { describe, expect, it } from 'bun:test'

import { BLOB_PREFIX, blobPathOf, ROUTES_PREFIX, routePathOf } from '../storage-path'

describe('blobPathOf', () => {
  it('stores content once under blobs/<sha256>', () => {
    const digest = 'a'.repeat(64)
    expect(blobPathOf(digest)).toBe(`blobs/${digest}`)
    expect(BLOB_PREFIX).toBe('blobs/')
  })
})

describe('routePathOf', () => {
  it('writes the routing object under routes/<token>-<slug>.json', () => {
    expect(routePathOf({ token: 'k7f2m9qx', slug: 'dashboard' })).toBe(
      'routes/k7f2m9qx-dashboard.json',
    )
    expect(ROUTES_PREFIX).toBe('routes/')
  })
})
