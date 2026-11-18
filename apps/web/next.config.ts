import { execSync } from 'node:child_process'

import type { NextConfig } from 'next'

import { resolveApiOrigin } from './src/lib/api-origin'

const ATLAS_PREVIEW_ORIGINS = ['*.byatlas.dev']

const publicUrl = process.env.PUBLIC_URL ?? ''
const publicHosts = URL.canParse(publicUrl) ? [new URL(publicUrl).hostname] : []

const devOrigins = [
  ...ATLAS_PREVIEW_ORIGINS,
  ...(process.env.ATLAS_WEB_DEV_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0),
  ...publicHosts,
]

function readGitCommit(): string {
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return ''
  }
}

const webCommit = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || readGitCommit()

const sharedConfig: NextConfig = {
  allowedDevOrigins: devOrigins,
  output: 'standalone',
  env: {
    ATLAS_API_ORIGIN: resolveApiOrigin(process.env),
    ATLAS_WEB_COMMIT: webCommit,
    ATLAS_WEB_VERSION: process.env.ATLAS_VERSION ?? '',
  },
  transpilePackages: [
    '@dltech/atlas-api-router',
    '@dltech/atlas-client',
    '@dltech/atlas-core',
    '@dltech/atlas-harness',
    '@dltech/atlas-models',
    '@dltech/atlas-protocol',
    '@dltech/atlas-schedule',
    '@dltech/atlas-ui',
    '@dltech/atlas-wire',
  ],
}

const nextConfig: NextConfig = {
  ...sharedConfig,
  async rewrites() {
    const apiOrigin = resolveApiOrigin(process.env)
    return [
      {
        source: '/api/auth/callback/:path*',
        destination: `${apiOrigin}/api/auth/callback/:path*`,
      },
      { source: '/v1/mcp/oauth/callback', destination: `${apiOrigin}/v1/mcp/oauth/callback` },
    ]
  },
}

export default nextConfig
