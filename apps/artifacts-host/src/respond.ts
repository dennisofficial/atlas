import { contentTypeOf, routeCandidatesOf, type RouteCandidate } from '@dltech/atlas-artifacts'

import { cacheHeadersOf } from './cache-headers'
import { subdomainOf } from './host-label'
import type { ObjectFetcher, RouteObjectFetcher } from './route-object'

export type RespondArgs = {
  request: Request
  domain: string | undefined
  fetchRoute: RouteObjectFetcher
  fetchObject: ObjectFetcher
}

const SERVED_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD'])

const securityHeaders = (): Record<string, string> => ({
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
})

const hostOf = (request: Request): string =>
  request.headers.get('host') ?? new URL(request.url).host

const methodNotAllowed = (): Response =>
  new Response(null, {
    status: 405,
    headers: {
      ...securityHeaders(),
      ...cacheHeadersOf({ path: '', status: 405 }),
      Allow: 'GET, HEAD',
    },
  })

const emptyNotFound = (): Response =>
  new Response(null, {
    status: 404,
    headers: { ...securityHeaders(), ...cacheHeadersOf({ path: '', status: 404 }) },
  })

const fileResponse = ({
  request,
  candidate,
  body,
  status,
}: {
  request: Request
  candidate: RouteCandidate
  body: ReadableStream<Uint8Array> | null
  status: 200 | 404
}): Response =>
  new Response(request.method === 'HEAD' ? null : body, {
    status,
    headers: {
      ...securityHeaders(),
      ...cacheHeadersOf({ path: candidate.path, status }),
      'Content-Type': contentTypeOf(candidate.path),
    },
  })

const drain = async ({
  request,
  object,
}: {
  request: Request
  object: Response
}): Promise<void> => {
  if (request.method === 'HEAD') await object.body?.cancel()
}

export async function respond({
  request,
  domain,
  fetchRoute,
  fetchObject,
}: RespondArgs): Promise<Response> {
  if (!SERVED_METHODS.has(request.method)) return methodNotAllowed()

  const subdomain = subdomainOf({ host: hostOf(request), domain })
  if (subdomain === null) return emptyNotFound()

  const route = await fetchRoute(subdomain)
  if (route === null) return emptyNotFound()

  const resolution = routeCandidatesOf({
    id: subdomain,
    pathname: new URL(request.url).pathname,
    serve: route.serve,
  })
  if (resolution === null) return emptyNotFound()

  for (const candidate of resolution.candidates) {
    const object = await fetchObject(candidate.key)
    if (object === null) continue
    await drain({ request, object })
    return fileResponse({ request, candidate, body: object.body, status: 200 })
  }

  if (resolution.notFound !== null) {
    const object = await fetchObject(resolution.notFound.key)
    if (object !== null) {
      await drain({ request, object })
      return fileResponse({
        request,
        candidate: resolution.notFound,
        body: object.body,
        status: 404,
      })
    }
  }

  return emptyNotFound()
}
