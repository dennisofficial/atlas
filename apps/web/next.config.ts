import { dirname, join } from 'node:path'

import type { NextConfig } from 'next'

const apiOrigin = process.env.ATLAS_API_ORIGIN ?? 'http://localhost:3400'

const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: join(dirname(import.meta.filename), '..', '..'),
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiOrigin}/api/:path*` }]
  },
}

export default config
