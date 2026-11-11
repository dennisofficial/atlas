import { respond } from '../src/respond'
import { injectEncryptedTierEnv } from '../src/tier-env'
import { createBlobFetcher, createRouteFetcher } from '../src/route-object'

injectEncryptedTierEnv()

const UNCONFIGURED_BODY = 'artifact host is not configured'

const unconfigured = (): Response =>
  new Response(UNCONFIGURED_BODY, {
    status: 503,
    headers: {
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
      'CDN-Cache-Control': 'no-store',
    },
  })

const handler = {
  async fetch(request: Request): Promise<Response> {
    const baseUrl = process.env.ARTIFACT_BLOB_BASE_URL?.trim()
    if (baseUrl === undefined || baseUrl.length === 0) return unconfigured()
    return respond({
      request,
      domain: process.env.ARTIFACT_DOMAIN?.trim() || undefined,
      fetchRoute: createRouteFetcher(baseUrl),
      fetchBlob: createBlobFetcher(baseUrl),
    })
  },
}

export default handler
