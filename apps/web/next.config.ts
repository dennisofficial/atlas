import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@dltech/atlas-ui'],
  async rewrites() {
    const configured = process.env.ATLAS_API_ORIGIN
    const apiOrigin =
      configured !== undefined && configured.length > 0
        ? configured
        : process.env.VERCEL_ENV === 'production' || process.env.VERCEL_ENV === 'preview'
          ? 'https://api.byatlas.io'
          : 'http://localhost:3400'
    return [
      { source: '/api/:path*', destination: `${apiOrigin}/api/:path*` },
      { source: '/v1/:path*', destination: `${apiOrigin}/v1/:path*` },
    ]
  },
}

export default nextConfig
