import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  devIndicators: false,
  transpilePackages: ['@dltech/atlas-ui'],
}

export default nextConfig
