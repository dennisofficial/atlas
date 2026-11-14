import { respond } from './respond'
import { createObjectFetcher, createRouteFetcher, type ArtifactBucket } from './route-object'

export type ArtifactHostEnv = {
  ARTIFACTS?: ArtifactBucket
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
    },
  })

const domainOf = (env: ArtifactHostEnv): string | undefined =>
  env.ARTIFACT_DOMAIN?.trim() || undefined

export default {
  async fetch(request: Request, env: ArtifactHostEnv): Promise<Response> {
    const bucket = env.ARTIFACTS
    if (bucket === undefined) return unconfigured()
    return respond({
      request,
      domain: domainOf(env),
      fetchRoute: createRouteFetcher(bucket),
      fetchObject: createObjectFetcher(bucket),
    })
  },
}
