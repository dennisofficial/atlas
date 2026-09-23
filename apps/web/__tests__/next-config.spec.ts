import { afterEach, describe, expect, it } from 'bun:test'

import nextConfig from '../next.config'

const originalApiOrigin = process.env.ATLAS_API_ORIGIN
const originalVercelEnv = process.env.VERCEL_ENV

afterEach(() => {
  if (originalApiOrigin === undefined) {
    delete process.env.ATLAS_API_ORIGIN
  } else {
    process.env.ATLAS_API_ORIGIN = originalApiOrigin
  }
  if (originalVercelEnv === undefined) {
    delete process.env.VERCEL_ENV
  } else {
    process.env.VERCEL_ENV = originalVercelEnv
  }
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

  it('falls back to the local API origin off Vercel', async () => {
    delete process.env.ATLAS_API_ORIGIN
    delete process.env.VERCEL_ENV

    const result = await nextConfig.rewrites!()

    expect(result).toEqual([
      { source: '/api/:path*', destination: 'http://localhost:3400/api/:path*' },
      { source: '/v1/:path*', destination: 'http://localhost:3400/v1/:path*' },
    ])
  })

  it('defaults to the production API origin on Vercel when the var is unset', async () => {
    delete process.env.ATLAS_API_ORIGIN
    process.env.VERCEL_ENV = 'production'

    const result = await nextConfig.rewrites!()

    expect(result).toEqual([
      { source: '/api/:path*', destination: 'https://api.byatlas.io/api/:path*' },
      { source: '/v1/:path*', destination: 'https://api.byatlas.io/v1/:path*' },
    ])
  })

  it('treats an empty ATLAS_API_ORIGIN as unset', async () => {
    process.env.ATLAS_API_ORIGIN = ''
    process.env.VERCEL_ENV = 'production'

    const result = await nextConfig.rewrites!()

    expect(result).toEqual([
      { source: '/api/:path*', destination: 'https://api.byatlas.io/api/:path*' },
      { source: '/v1/:path*', destination: 'https://api.byatlas.io/v1/:path*' },
    ])
  })
})
