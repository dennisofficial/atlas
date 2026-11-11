import { describe, expect, test } from 'bun:test'

import type { ArtifactSpec, ManifestEntry } from '@dltech/atlas-artifacts'

import type { HostLabel } from '../host-label'
import { respond } from '../respond'
import type { BlobFetcher, RouteObject, RouteObjectFetcher } from '../route-object'

const HOST = 'k7f2m9qx-dashboard.byatlas.site'
const DOMAIN = 'byatlas.site'

type Fixture = { entry: ManifestEntry; body: string }

const shaOf = (body: string): string => new Bun.CryptoHasher('sha256').update(body).digest('hex')

const fixtureOf = ({
  path,
  body,
  type,
}: {
  path: string
  body: string
  type?: string
}): Fixture => ({
  entry: {
    path,
    tree: 'dist',
    sha256: shaOf(body),
    size: body.length,
    type: type ?? 'text/html; charset=utf-8',
  },
  body,
})

const HTML = '<!doctype html><title>dashboard</title>'
const APP_JS = 'console.log("app")'
const MISSING_HTML = '<!doctype html><title>not found</title>'
const DOCS_HTML = '<!doctype html><title>docs</title>'
const STYLE_CSS = 'body { margin: 0 }'

const html = fixtureOf({ path: 'index.html', body: HTML })
const appJs = fixtureOf({
  path: 'assets/app-1a2b3c4d.js',
  body: APP_JS,
  type: 'application/javascript; charset=utf-8',
})
const docsHtml = fixtureOf({ path: 'docs/index.html', body: DOCS_HTML })
const missingHtml = fixtureOf({ path: '404.html', body: MISSING_HTML })
const styleCss = fixtureOf({
  path: 'style.css',
  body: STYLE_CSS,
  type: 'application/octet-stream',
})
const FIXTURES = [html, appJs, docsHtml, missingHtml, styleCss]

const routeOf = ({
  fixtures = FIXTURES,
  serve = { spa: false },
}: {
  fixtures?: Fixture[]
  serve?: ArtifactSpec['serve']
} = {}): RouteObject => ({
  artifactId: 'art_1',
  slug: 'dashboard',
  name: 'Dashboard',
  version: 3,
  manifest: fixtures.map((fixture) => fixture.entry),
  serve,
})

const stubs = ({
  route,
}: {
  route?: RouteObject | null | undefined
} = {}): {
  fetchRoute: RouteObjectFetcher
  fetchBlob: BlobFetcher
  labels: HostLabel[]
} => {
  const bodies = new Map(FIXTURES.map((fixture) => [fixture.entry.sha256, fixture.body]))
  const labels: HostLabel[] = []
  const resolved = route === undefined ? routeOf() : route
  return {
    labels,
    fetchRoute: async (label) => {
      labels.push(label)
      return resolved
    },
    fetchBlob: async (sha256) => {
      const body = bodies.get(sha256)
      if (body === undefined) return null
      return new Response(body, { headers: { 'content-type': 'application/octet-stream' } })
    },
  }
}

const requestOf = ({
  path = '/',
  method = 'GET',
}: {
  path?: string
  method?: string
} = {}): Request => new Request(`https://${HOST}${path}`, { method })

const serve = async ({
  path = '/',
  method = 'GET',
  route,
  host,
}: {
  path?: string
  method?: string
  route?: RouteObject | null
  host?: string
} = {}): Promise<Response> => {
  const stubbed = stubs({ route })
  const request =
    host === undefined
      ? requestOf({ path, method })
      : new Request(`http://localhost:3000${path}`, { method, headers: { host } })
  return respond({
    request,
    domain: DOMAIN,
    fetchRoute: stubbed.fetchRoute,
    fetchBlob: stubbed.fetchBlob,
  })
}

describe('respond', () => {
  test('serves the index for the root path', async () => {
    const response = await serve()
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(HTML)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
  })

  test('serves a directory index', async () => {
    const response = await serve({ path: '/docs/' })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(DOCS_HTML)
  })

  test('caches an unhashed path for 60s at the browser and the edge', async () => {
    const response = await serve()
    expect(response.headers.get('cache-control')).toBe(
      'public, max-age=60, stale-while-revalidate=86400',
    )
    expect(response.headers.get('cdn-cache-control')).toBe('s-maxage=60')
  })

  test('caches a hashed path for a year, immutable', async () => {
    const response = await serve({ path: '/assets/app-1a2b3c4d.js' })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(APP_JS)
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(response.headers.get('cdn-cache-control')).toBe('s-maxage=31536000')
  })

  test('takes the content type from the manifest, not from the store', async () => {
    const response = await serve({ path: '/assets/app-1a2b3c4d.js' })
    expect(response.headers.get('content-type')).toBe('application/javascript; charset=utf-8')
  })

  test('falls back to the path extension when the manifest type is generic', async () => {
    const response = await serve({ path: '/style.css' })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/css; charset=utf-8')
  })

  test('serves the SPA shell for a client route', async () => {
    const response = await serve({
      path: '/settings/profile',
      route: routeOf({ serve: { spa: true } }),
    })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(HTML)
  })

  test('serves the custom 404 entry with a 404 status', async () => {
    const response = await serve({
      path: '/missing.js',
      route: routeOf({ serve: { spa: false, notFound: '404.html' } }),
    })
    expect(response.status).toBe(404)
    expect(await response.text()).toBe(MISSING_HTML)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('cdn-cache-control')).toBe('no-store')
  })

  test('answers a plain 404 with no body', async () => {
    const response = await serve({ path: '/missing.js' })
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  test('answers 404 when the routing object is absent', async () => {
    const response = await serve({ route: null })
    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  test('answers 404 without fetching a route for an unlabelled host', async () => {
    const response = await serve({ host: 'dashboard.byatlas.site' })
    expect(response.status).toBe(404)
  })

  test('reads the host header rather than the request url', async () => {
    const response = await serve({ host: HOST })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(HTML)
  })

  test('answers 404 when the blob is missing', async () => {
    const orphan = fixtureOf({ path: 'index.html', body: 'never stored' })
    const response = await respond({
      request: requestOf(),
      domain: DOMAIN,
      fetchRoute: async () => routeOf({ fixtures: [orphan] }),
      fetchBlob: async () => null,
    })
    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  test('answers HEAD with the same status and no body', async () => {
    const response = await serve({ method: 'HEAD' })
    expect(response.status).toBe(200)
    expect(response.body).toBeNull()
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(response.headers.get('cdn-cache-control')).toBe('s-maxage=60')
  })

  test('answers HEAD on a missing path without a body', async () => {
    const response = await serve({ method: 'HEAD', path: '/missing.js' })
    expect(response.status).toBe(404)
    expect(response.body).toBeNull()
  })

  test('rejects POST with 405 and an Allow header', async () => {
    const response = await serve({ method: 'POST' })
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET, HEAD')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  test('rejects PUT with 405 before resolving the host', async () => {
    const stubbed = stubs()
    const response = await respond({
      request: requestOf({ method: 'PUT' }),
      domain: DOMAIN,
      fetchRoute: stubbed.fetchRoute,
      fetchBlob: stubbed.fetchBlob,
    })
    expect(response.status).toBe(405)
    expect(stubbed.labels).toEqual([])
  })

  test('always sets nosniff and no-referrer, and no cookie or CORS header', async () => {
    const response = await serve()
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })

  test('looks up the route by the request label', async () => {
    const stubbed = stubs()
    await respond({
      request: requestOf(),
      domain: DOMAIN,
      fetchRoute: stubbed.fetchRoute,
      fetchBlob: stubbed.fetchBlob,
    })
    expect(stubbed.labels).toEqual([{ token: 'k7f2m9qx', slug: 'dashboard' }])
  })
})
