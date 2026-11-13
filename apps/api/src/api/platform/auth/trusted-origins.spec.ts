import { describe, expect, it } from 'bun:test'
import { missingTrustedOrigins } from './trusted-origins'

describe('missingTrustedOrigins', () => {
  it('reports nothing when the web origin is listed', () => {
    expect(
      missingTrustedOrigins({
        trustedOrigins: ['http://localhost:3001', 'http://localhost:3400'],
        webOrigin: 'http://localhost:3001',
      }),
    ).toEqual([])
  })

  it('returns the web origin when it is not listed', () => {
    expect(
      missingTrustedOrigins({
        trustedOrigins: ['http://localhost:3400'],
        webOrigin: 'http://localhost:4000',
      }),
    ).toEqual(['http://localhost:4000'])
  })

  it('ignores a trailing slash and case differences', () => {
    expect(
      missingTrustedOrigins({
        trustedOrigins: ['HTTP://LOCALHOST:3001/'],
        webOrigin: 'http://localhost:3001',
      }),
    ).toEqual([])
    expect(
      missingTrustedOrigins({
        trustedOrigins: ['http://localhost:3001'],
        webOrigin: 'http://localhost:3001/',
      }),
    ).toEqual([])
  })

  it('reports nothing when the web origin is empty', () => {
    expect(missingTrustedOrigins({ trustedOrigins: [], webOrigin: '' })).toEqual([])
    expect(missingTrustedOrigins({ trustedOrigins: [], webOrigin: '   ' })).toEqual([])
  })
})
