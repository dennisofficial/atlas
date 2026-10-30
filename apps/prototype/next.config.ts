import type { NextConfig } from 'next'

const publicUrl = process.env.PUBLIC_URL ?? ''
const publicHosts = URL.canParse(publicUrl) ? [new URL(publicUrl).hostname] : []

const devOrigins = [
  ...(process.env.ATLAS_PROTOTYPE_DEV_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0),
  ...publicHosts,
]

const nextConfig: NextConfig = {
  allowedDevOrigins: devOrigins,
  devIndicators: false,
  transpilePackages: ['@dltech/atlas-ui'],
}

export default nextConfig
