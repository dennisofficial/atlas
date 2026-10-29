import type { NextConfig } from 'next'

const devOrigins = (process.env.ATLAS_PROTOTYPE_DEV_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0)

const nextConfig: NextConfig = {
  allowedDevOrigins: devOrigins,
  devIndicators: false,
  transpilePackages: ['@dltech/atlas-ui'],
}

export default nextConfig
