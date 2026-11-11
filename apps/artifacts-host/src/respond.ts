import {
  contentTypeOf,
  entriesByPath,
  type ManifestEntry,
  resolveRequest,
  UNKNOWN_CONTENT_TYPE,
} from '@dltech/atlas-artifacts'

import { cacheHeadersOf } from './cache-headers'
import { labelOf, type HostLabel } from './host-label'
import type { BlobFetcher, RouteObjectFetcher } from './route-object'

export type RespondArgs = {
  request: Request
  domain: string | undefined
  fetchRoute: RouteObjectFetcher
  fetchBlob: BlobFetcher
}

const SERVED_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD'])
const SERVED_TREE = 'dist'

const securityHeaders = (): Record<string, string> => ({
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
})

const hostOf = (request: Request): string =>
  request.headers.get('host') ?? new URL(request.url).host

const labelOfRequest = ({
  request,
  domain,
}: {
  request: Request
  domain: string | undefined
}): HostLabel | null => labelOf({ host: hostOf(request), domain })

const methodNotAllowed = (): Response =>
  new Response(null, {
    status: 405,
    headers: {
      ...securityHeaders(),
      ...cacheHeadersOf({ path: '', status: 405 }),
      Allow: 'GET, HEAD',
    },
  })

const notFound = (): Response =>
  new Response(null, {
    status: 404,
    headers: { ...securityHeaders(), ...cacheHeadersOf({ path: '', status: 404 }) },
  })

const contentTypeOfEntry = (entry: ManifestEntry): string =>
  entry.type === UNKNOWN_CONTENT_TYPE ? contentTypeOf(entry.path) : entry.type

export async function respond({
  request,
  domain,
  fetchRoute,
  fetchBlob,
}: RespondArgs): Promise<Response> {
  if (!SERVED_METHODS.has(request.method)) return methodNotAllowed()

  const label = labelOfRequest({ request, domain })
  if (label === null) return notFound()

  const route = await fetchRoute(label)
  if (route === null) return notFound()

  const resolution = resolveRequest({
    pathname: new URL(request.url).pathname,
    files: entriesByPath(route.manifest, SERVED_TREE),
    serve: route.serve,
  })

  const entry = resolution.entry
  if (entry === undefined) return notFound()

  const blob = await fetchBlob(entry.sha256)
  if (blob === null) return notFound()
  if (request.method === 'HEAD') await blob.body?.cancel()

  const status = resolution.kind === 'file' ? 200 : 404
  return new Response(request.method === 'HEAD' ? null : blob.body, {
    status,
    headers: {
      ...securityHeaders(),
      ...cacheHeadersOf({ path: entry.path, status }),
      'Content-Type': contentTypeOfEntry(entry),
    },
  })
}
