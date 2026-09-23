import { afterEach, describe, expect, it } from 'bun:test'

import nextConfig from '../next.config'

const originalApiOrigin = process.env.ATLAS_API_ORIGIN

afterEach(() => {
  if (originalApiOrigin === undefined) {
    delete process.env.ATLAS_API_ORIGIN
    return
  }
  process.env.ATLAS_API_ORIGIN = originalApiOrigin
})

describe('next.config', () => {
  it('transpiles the atlas-ui workspace package', () => {
    expect(nextConfig.transpilePackages).toEqual(['@dltech/atlas-ui'])
  })
})

describe('next.config rewrites', () => {
  it('proxies /api to ATLAS_API_ORIGIN when set', async () => {
    process.env.ATLAS_API_ORIGIN = 'https://api.byatlas.io'

    const rewrites = nextConfig.rewrites
    expect(rewrites).toBeDefined()
    const result = await rewrites!()

    expect(result).toEqual([
      { source: '/api/:path*', destination: 'https://api.byatlas.io/api/:path*' },
      { source: '/v1/:path*', destination: 'https://api.byatlas.io/v1/:path*' },
    ])
  })

  it('falls back to the local API origin', async () => {
    delete process.env.ATLAS_API_ORIGIN

    const result = await nextConfig.rewrites!()

    expect(result).toEqual([
      { source: '/api/:path*', destination: 'http://localhost:3400/api/:path*' },
      { source: '/v1/:path*', destination: 'http://localhost:3400/v1/:path*' },
    ])
  })
})
