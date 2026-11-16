import { contentTypeOf, routeCandidatesOf, type RouteCandidate } from '@dltech/atlas-artifacts'

import { cacheHeadersOf } from './cache-headers'
import { subdomainOf } from './host-label'
import { artifactNotFoundHtml, deploymentNotFoundHtml } from './pages'
import type { ObjectFetcher, RouteObjectFetcher, StoredObject } from './route-object'

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

const htmlResponse = ({
  request,
  html,
  status,
}: {
  request: Request
  html: string
  status: 404
}): Response =>
  new Response(request.method === 'HEAD' ? null : html, {
    status,
    headers: {
      ...securityHeaders(),
      ...cacheHeadersOf({ path: '', status }),
      'Content-Type': 'text/html; charset=utf-8',
    },
  })

const artifactNotFound = ({ request, host }: { request: Request; host: string }): Response =>
  htmlResponse({ request, html: artifactNotFoundHtml({ host }), status: 404 })

const deploymentNotFound = ({ request }: { request: Request }): Response =>
  htmlResponse({ request, html: deploymentNotFoundHtml(), status: 404 })

const fileHeadersOf = ({
  candidate,
  status,
  etag,
}: {
  candidate: RouteCandidate
  status: 200 | 404
  etag: string | null
}): Record<string, string> => ({
  ...securityHeaders(),
  ...cacheHeadersOf({ path: candidate.path, status }),
  'Content-Type': contentTypeOf(candidate.path),
  ...(etag === null ? {} : { ETag: etag }),
})

const normalizeEtag = (etag: string): string => etag.trim().replace(/^W\//, '')

const etagMatches = ({ header, etag }: { header: string | null; etag: string }): boolean => {
  if (header === null) return false
  const wanted = normalizeEtag(etag)
  return header.split(',').some((entry) => {
    const candidate = normalizeEtag(entry)
    return candidate === '*' || candidate === wanted
  })
}

const storedResponse = async ({
  request,
  candidate,
  object,
  status,
}: {
  request: Request
  candidate: RouteCandidate
  object: StoredObject
  status: 200 | 404
}): Promise<Response> => {
  const headers = fileHeadersOf({ candidate, status, etag: status === 200 ? object.etag : null })
  if (request.method === 'HEAD') {
    await object.body.cancel()
    return new Response(null, { status, headers })
  }
  const revalidates =
    status === 200 &&
    etagMatches({ header: request.headers.get('if-none-match'), etag: object.etag })
  if (revalidates) {
    await object.body.cancel()
    return new Response(null, { status: 304, headers })
  }
  return new Response(object.body, { status, headers })
}

export async function respond({
  request,
  domain,
  fetchRoute,
  fetchObject,
}: RespondArgs): Promise<Response> {
  if (!SERVED_METHODS.has(request.method)) return methodNotAllowed()

  const host = hostOf(request)
  const subdomain = subdomainOf({ host, domain })
  if (subdomain === null) return artifactNotFound({ request, host })

  const route = await fetchRoute(subdomain)
  if (route === null) return artifactNotFound({ request, host })

  const resolution = routeCandidatesOf({
    id: subdomain,
    version: route.version,
    pathname: new URL(request.url).pathname,
    serve: route.serve,
  })
  if (resolution === null) return deploymentNotFound({ request })

  for (const candidate of resolution.candidates) {
    const object = await fetchObject(candidate.key)
    if (object === null) continue
    return storedResponse({ request, candidate, object, status: 200 })
  }

  if (resolution.notFound !== null) {
    const object = await fetchObject(resolution.notFound.key)
    if (object !== null) {
      return storedResponse({ request, candidate: resolution.notFound, object, status: 404 })
    }
  }

  return deploymentNotFound({ request })
}
