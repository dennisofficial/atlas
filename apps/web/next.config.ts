import type { NextConfig } from 'next'

import { resolveApiOrigin } from './src/lib/api-origin'

const publicUrl = process.env.PUBLIC_URL ?? ''
const publicHosts = URL.canParse(publicUrl) ? [new URL(publicUrl).hostname] : []

const devOrigins = [
  ...(process.env.ATLAS_WEB_DEV_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0),
  ...publicHosts,
]

const desktop = process.env.ATLAS_WEB_TARGET === 'desktop'

const sharedConfig: NextConfig = {
  allowedDevOrigins: devOrigins,
  transpilePackages: [
    '@dltech/atlas-api-router',
    '@dltech/atlas-client',
    '@dltech/atlas-core',
    '@dltech/atlas-models',
    '@dltech/atlas-ui',
    '@dltech/atlas-wire',
  ],
}

const desktopConfig: NextConfig = {
  ...sharedConfig,
  output: 'export',
  images: { unoptimized: true },
}

const cloudConfig: NextConfig = {
  ...sharedConfig,
  async rewrites() {
    const apiOrigin = resolveApiOrigin(process.env)
    return [
      { source: '/api/:path*', destination: `${apiOrigin}/api/:path*` },
      { source: '/v1/:path*', destination: `${apiOrigin}/v1/:path*` },
    ]
  },
}

const nextConfig = desktop ? desktopConfig : cloudConfig

export default nextConfig
