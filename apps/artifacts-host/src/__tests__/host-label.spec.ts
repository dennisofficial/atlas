import { describe, expect, test } from 'bun:test'

import { subdomainOf } from '../host-label'

const DOMAIN = 'byatlas.site'

describe('subdomainOf', () => {
  test('reads the artifact id from the host label', () => {
    expect(subdomainOf({ host: 'k7f2m9qxabcd.byatlas.site', domain: DOMAIN })).toBe('k7f2m9qxabcd')
  })

  test('lowercases the host', () => {
    expect(subdomainOf({ host: 'K7F2M9QXABCD.ByAtlas.Site', domain: DOMAIN })).toBe('k7f2m9qxabcd')
  })

  test('drops a port suffix', () => {
    expect(subdomainOf({ host: 'k7f2m9qxabcd.byatlas.site:3000', domain: DOMAIN })).toBe(
      'k7f2m9qxabcd',
    )
  })

  test('reads the label without a configured domain', () => {
    expect(subdomainOf({ host: 'k7f2m9qxabcd.byatlas.site', domain: undefined })).toBe(
      'k7f2m9qxabcd',
    )
  })

  test('rejects an empty host', () => {
    expect(subdomainOf({ host: '', domain: DOMAIN })).toBeNull()
  })

  test('rejects the apex domain', () => {
    expect(subdomainOf({ host: DOMAIN, domain: DOMAIN })).toBeNull()
  })

  test('rejects a host under another domain', () => {
    expect(subdomainOf({ host: 'k7f2m9qxabcd.example.com', domain: DOMAIN })).toBeNull()
  })

  test('rejects a nested label', () => {
    expect(subdomainOf({ host: 'a.k7f2m9qxabcd.byatlas.site', domain: DOMAIN })).toBeNull()
  })

  test('rejects a trailing-dot host', () => {
    expect(subdomainOf({ host: 'k7f2m9qxabcd.byatlas.site.', domain: DOMAIN })).toBeNull()
  })

  test('rejects a label that is not hostname-safe', () => {
    expect(subdomainOf({ host: 'k7f2m9qx_abcd.byatlas.site', domain: DOMAIN })).toBeNull()
    expect(subdomainOf({ host: '-lead.byatlas.site', domain: DOMAIN })).toBeNull()
  })

  test('rejects a label longer than 63 characters', () => {
    expect(subdomainOf({ host: `${'a'.repeat(64)}.byatlas.site`, domain: DOMAIN })).toBeNull()
  })
})
