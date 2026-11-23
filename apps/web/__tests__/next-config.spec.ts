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
  it('transpiles the atlas api-router, classifier, client, core, credentials, harness, models, protocol, ui and wire workspace packages', () => {
    expect(nextConfig.transpilePackages).toEqual([
      '@dltech/atlas-api-router',
      '@dltech/atlas-classifier',
      '@dltech/atlas-client',
      '@dltech/atlas-core',
      '@dltech/atlas-credentials',
      '@dltech/atlas-harness',
      '@dltech/atlas-models',
      '@dltech/atlas-protocol',
      '@dltech/atlas-schedule',
      '@dltech/atlas-ui',
      '@dltech/atlas-wire',
    ])
  })
})

describe('next.config rewrites', () => {
  it('proxies the provider callbacks that redirect to the web host and PostHog ingestion', async () => {
    process.env.ATLAS_API_ORIGIN = 'https://api.byatlas.io'

    const rewrites = nextConfig.rewrites
    expect(rewrites).toBeDefined()
    const result = await rewrites!()

    expect(result).toEqual([
      {
        source: '/api/auth/callback/:path*',
        destination: 'https://api.byatlas.io/api/auth/callback/:path*',
      },
      {
        source: '/v1/mcp/oauth/callback',
        destination: 'https://api.byatlas.io/v1/mcp/oauth/callback',
      },
      {
        source: '/ingest/static/:path*',
        destination: 'https://us-assets.i.posthog.com/static/:path*',
      },
      {
        source: '/ingest/:path*',
        destination: 'https://us.i.posthog.com/:path*',
      },
    ])
  })

  it('falls back to the local API origin off Vercel', async () => {
    delete process.env.ATLAS_API_ORIGIN
    delete process.env.VERCEL_ENV

    const result = await nextConfig.rewrites!()

    expect(result[0]?.destination).toBe('http://localhost:3400/api/auth/callback/:path*')
  })

  it('keeps no generic /api or /v1 proxy for the browser to hop through', async () => {
    delete process.env.ATLAS_API_ORIGIN
    delete process.env.VERCEL_ENV

    const result = await nextConfig.rewrites!()

    expect(result.map((rewrite) => rewrite.source)).toEqual([
      '/api/auth/callback/:path*',
      '/v1/mcp/oauth/callback',
      '/ingest/static/:path*',
      '/ingest/:path*',
    ])
  })
})

describe('next.config env', () => {
  it('inlines the API origin for browser bundles', () => {
    expect(nextConfig.env?.ATLAS_API_ORIGIN).toBeString()
  })
})
