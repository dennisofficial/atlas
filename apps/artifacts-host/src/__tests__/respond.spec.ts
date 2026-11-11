import { describe, expect, test } from 'bun:test'

import { respond } from '../respond'
import type { ObjectFetcher, RouteObject, RouteObjectFetcher } from '../route-object'

const ID = 'k7f2m9qxabcd'
const HOST = `${ID}.byatlas.site`
const DOMAIN = 'byatlas.site'

type Fixture = { path: string; body: string }

const fixtureOf = ({ path, body }: { path: string; body: string }): Fixture => ({ path, body })

const HTML = '<!doctype html><title>dashboard</title>'
const APP_JS = 'console.log("app")'
const MISSING_HTML = '<!doctype html><title>not found</title>'
const DOCS_HTML = '<!doctype html><title>docs</title>'
const STYLE_CSS = 'body { margin: 0 }'

const FIXTURES: Fixture[] = [
  fixtureOf({ path: 'index.html', body: HTML }),
  fixtureOf({ path: 'assets/app-1a2b3c4d.js', body: APP_JS }),
  fixtureOf({ path: 'docs/index.html', body: DOCS_HTML }),
  fixtureOf({ path: '404.html', body: MISSING_HTML }),
  fixtureOf({ path: 'style.css', body: STYLE_CSS }),
]

const keyOf = (path: string): string => `artifacts/${ID}/_route/${path}`

const routeOf = ({
  serve = { spa: false },
}: {
  serve?: RouteObject['serve']
} = {}): RouteObject => ({
  artifactId: 'art_1',
  subdomain: ID,
  name: 'Dashboard',
  serve,
})

const stubs = ({
  route,
  files = FIXTURES,
}: {
  route?: RouteObject | null | undefined
  files?: Fixture[] | undefined
} = {}): {
  fetchRoute: RouteObjectFetcher
  fetchObject: ObjectFetcher
  labels: string[]
  keys: string[]
} => {
  const store = new Map(files.map((fixture) => [keyOf(fixture.path), fixture.body]))
  const labels: string[] = []
  const keys: string[] = []
  const resolved = route === undefined ? routeOf() : route
  return {
    labels,
    keys,
    fetchRoute: async (subdomain) => {
      labels.push(subdomain)
      return resolved
    },
    fetchObject: async (key) => {
      keys.push(key)
      const body = store.get(key)
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

const serveWith = async ({
  path = '/',
  method = 'GET',
  route,
  files,
  host,
}: {
  path?: string
  method?: string
  route?: RouteObject | null | undefined
  files?: Fixture[] | undefined
  host?: string
} = {}): Promise<Response> => {
  const stubbed = stubs({ route, files })
  const request =
    host === undefined
      ? requestOf({ path, method })
      : new Request(`http://localhost:3000${path}`, { method, headers: { host } })
  return respond({
    request,
    domain: DOMAIN,
    fetchRoute: stubbed.fetchRoute,
    fetchObject: stubbed.fetchObject,
  })
}

describe('respond', () => {
  test('serves the index for the root path', async () => {
    const response = await serveWith()
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(HTML)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
  })

  test('serves a directory index', async () => {
    const response = await serveWith({ path: '/docs/' })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(DOCS_HTML)
  })

  test('caches an unhashed path for 60s at the browser and the edge', async () => {
    const response = await serveWith()
    expect(response.headers.get('cache-control')).toBe(
      'public, max-age=60, stale-while-revalidate=86400',
    )
    expect(response.headers.get('cdn-cache-control')).toBe('s-maxage=60')
  })

  test('caches a hashed path for a year, immutable', async () => {
    const response = await serveWith({ path: '/assets/app-1a2b3c4d.js' })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(APP_JS)
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(response.headers.get('cdn-cache-control')).toBe('s-maxage=31536000')
  })

  test('takes the content type from the served path', async () => {
    const response = await serveWith({ path: '/style.css' })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/css; charset=utf-8')
  })

  test('serves the SPA shell for a client route', async () => {
    const response = await serveWith({
      path: '/settings/profile',
      route: routeOf({ serve: { spa: true } }),
    })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(HTML)
  })

  test('serves the custom 404 file with a 404 status', async () => {
    const response = await serveWith({
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
    const response = await serveWith({ path: '/missing.js' })
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  test('answers 404 when the route object is absent', async () => {
    const response = await serveWith({ route: null })
    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  test('answers 404 without fetching a route for a nested host', async () => {
    const stubbed = stubs()
    const response = await respond({
      request: new Request('http://localhost:3000/', {
        headers: { host: 'a.dashboard.byatlas.site' },
      }),
      domain: DOMAIN,
      fetchRoute: stubbed.fetchRoute,
      fetchObject: stubbed.fetchObject,
    })
    expect(response.status).toBe(404)
    expect(stubbed.labels).toEqual([])
  })

  test('reads the host header rather than the request url', async () => {
    const response = await serveWith({ host: HOST })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(HTML)
  })

  test('answers 404 when the object is missing', async () => {
    const response = await serveWith({ files: [fixtureOf({ path: 'other.html', body: 'x' })] })
    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  test('answers HEAD with the same status and no body', async () => {
    const response = await serveWith({ method: 'HEAD' })
    expect(response.status).toBe(200)
    expect(response.body).toBeNull()
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(response.headers.get('cdn-cache-control')).toBe('s-maxage=60')
  })

  test('answers HEAD on a missing path without a body', async () => {
    const response = await serveWith({ method: 'HEAD', path: '/missing.js' })
    expect(response.status).toBe(404)
    expect(response.body).toBeNull()
  })

  test('rejects POST with 405 and an Allow header', async () => {
    const response = await serveWith({ method: 'POST' })
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
      fetchObject: stubbed.fetchObject,
    })
    expect(response.status).toBe(405)
    expect(stubbed.labels).toEqual([])
  })

  test('always sets nosniff and no-referrer, and no cookie or CORS header', async () => {
    const response = await serveWith()
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })

  test('looks up the route by the request subdomain', async () => {
    const stubbed = stubs()
    await respond({
      request: requestOf(),
      domain: DOMAIN,
      fetchRoute: stubbed.fetchRoute,
      fetchObject: stubbed.fetchObject,
    })
    expect(stubbed.labels).toEqual([ID])
  })

  test('fetches exactly the cases of the fallback chain it needs', async () => {
    const stubbed = stubs({ route: routeOf({ serve: { spa: true } }) })
    await respond({
      request: requestOf({ path: '/settings/profile' }),
      domain: DOMAIN,
      fetchRoute: stubbed.fetchRoute,
      fetchObject: stubbed.fetchObject,
    })
    expect(stubbed.keys).toEqual([
      keyOf('settings/profile'),
      keyOf('settings/profile/index.html'),
      keyOf('index.html'),
    ])
  })

  test('never touches the store for a traversal path', async () => {
    const stubbed = stubs({ route: routeOf({ serve: { spa: true, notFound: '404.html' } }) })
    const response = await respond({
      request: requestOf({ path: '/assets%5c..%5c..%5csecret' }),
      domain: DOMAIN,
      fetchRoute: stubbed.fetchRoute,
      fetchObject: stubbed.fetchObject,
    })
    expect(response.status).toBe(404)
    expect(stubbed.keys).toEqual([])
  })

  test('serves from the route tree of the requesting subdomain only', async () => {
    const stubbed = stubs()
    await respond({
      request: requestOf({ path: '/docs/' }),
      domain: DOMAIN,
      fetchRoute: stubbed.fetchRoute,
      fetchObject: stubbed.fetchObject,
    })
    expect(stubbed.keys.every((key) => key.startsWith(`artifacts/${ID}/_route/`))).toBe(true)
  })
})
