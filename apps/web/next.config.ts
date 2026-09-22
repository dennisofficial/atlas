import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  async rewrites() {
    const apiOrigin = process.env.ATLAS_API_ORIGIN ?? 'http://localhost:3400'
    return [{ source: '/api/:path*', destination: `${apiOrigin}/api/:path*` }]
  },
}

export default nextConfig
