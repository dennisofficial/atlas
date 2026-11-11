import { describe, expect, test } from 'bun:test'

import { labelOf } from '../host-label'

const DOMAIN = 'byatlas.site'

describe('labelOf', () => {
  test('reads token and slug from an artifact host', () => {
    expect(labelOf({ host: 'k7f2m9qx-dashboard.byatlas.site', domain: DOMAIN })).toEqual({
      token: 'k7f2m9qx',
      slug: 'dashboard',
    })
  })

  test('keeps hyphens inside the slug', () => {
    expect(labelOf({ host: 'k7f2m9qx-my-long-name.byatlas.site', domain: DOMAIN })).toEqual({
      token: 'k7f2m9qx',
      slug: 'my-long-name',
    })
  })

  test('lowercases the host', () => {
    expect(labelOf({ host: 'K7F2M9QX-Dashboard.ByAtlas.Site', domain: DOMAIN })).toEqual({
      token: 'k7f2m9qx',
      slug: 'dashboard',
    })
  })

  test('drops a port suffix', () => {
    expect(labelOf({ host: 'k7f2m9qx-dashboard.byatlas.site:3000', domain: DOMAIN })).toEqual({
      token: 'k7f2m9qx',
      slug: 'dashboard',
    })
  })

  test('reads the label without a configured domain', () => {
    expect(labelOf({ host: 'k7f2m9qx-dashboard.byatlas.site', domain: undefined })).toEqual({
      token: 'k7f2m9qx',
      slug: 'dashboard',
    })
  })

  test('rejects an empty host', () => {
    expect(labelOf({ host: '', domain: DOMAIN })).toBeNull()
  })

  test('rejects a host with no slug', () => {
    expect(labelOf({ host: 'k7f2m9qx.byatlas.site', domain: DOMAIN })).toBeNull()
  })

  test('rejects a host with no token', () => {
    expect(labelOf({ host: 'dashboard.byatlas.site', domain: DOMAIN })).toBeNull()
  })

  test('rejects a token that is not eight characters', () => {
    expect(labelOf({ host: 'k7f2m9-dashboard.byatlas.site', domain: DOMAIN })).toBeNull()
  })

  test('rejects the apex domain', () => {
    expect(labelOf({ host: DOMAIN, domain: DOMAIN })).toBeNull()
  })

  test('rejects a host under another domain', () => {
    expect(labelOf({ host: 'k7f2m9qx-dashboard.example.com', domain: DOMAIN })).toBeNull()
  })

  test('rejects a nested label', () => {
    expect(labelOf({ host: 'a.k7f2m9qx-dashboard.byatlas.site', domain: DOMAIN })).toBeNull()
  })

  test('rejects a preview-shaped host', () => {
    expect(labelOf({ host: '3000-abc123def4.byatlas.dev', domain: 'byatlas.dev' })).toBeNull()
  })

  test('rejects a preview-shaped label on the artifact domain', () => {
    expect(labelOf({ host: '12345678-3000-abc123def4.byatlas.site', domain: DOMAIN })).toBeNull()
  })

  test('rejects a trailing-dot host', () => {
    expect(labelOf({ host: 'k7f2m9qx-dashboard.byatlas.site.', domain: DOMAIN })).toBeNull()
  })
})
