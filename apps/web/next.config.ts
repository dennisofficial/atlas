import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@dltech/atlas-ui'],
  async rewrites() {
    const apiOrigin = process.env.ATLAS_API_ORIGIN ?? 'http://localhost:3400'
    return [
      { source: '/api/:path*', destination: `${apiOrigin}/api/:path*` },
      { source: '/v1/:path*', destination: `${apiOrigin}/v1/:path*` },
    ]
  },
}

export default nextConfig
