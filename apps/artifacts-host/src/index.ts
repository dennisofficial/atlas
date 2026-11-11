import { respond } from './respond'
import { createObjectFetcher, createRouteFetcher } from './route-object'

export type ArtifactHostEnv = {
  ARTIFACT_BLOB_BASE_URL?: string
  ARTIFACT_DOMAIN?: string
}

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

const baseUrlOf = (env: ArtifactHostEnv): string | null => {
  const baseUrl = env.ARTIFACT_BLOB_BASE_URL?.trim()
  return baseUrl === undefined || baseUrl.length === 0 ? null : baseUrl
}

const domainOf = (env: ArtifactHostEnv): string | undefined =>
  env.ARTIFACT_DOMAIN?.trim() || undefined

export default {
  async fetch(request: Request, env: ArtifactHostEnv): Promise<Response> {
    const baseUrl = baseUrlOf(env)
    if (baseUrl === null) return unconfigured()
    return respond({
      request,
      domain: domainOf(env),
      fetchRoute: createRouteFetcher(baseUrl),
      fetchObject: createObjectFetcher(baseUrl),
    })
  },
}
