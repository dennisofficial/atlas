import { describe, expect, test } from 'bun:test'

import { respond } from '../respond'
import {
  APP_JS,
  DOCS_HTML,
  DOMAIN,
  fixtureOf,
  HOST,
  HTML,
  ID,
  keyOf,
  MISSING_HTML,
  requestOf,
  routeOf,
  serveWith,
  stubs,
  STYLE_CSS,
} from './respond-fixtures'

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

  test('takes the content type from the served path', async () => {
    const response = await serveWith({ path: '/style.css' })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(STYLE_CSS)
    expect(response.headers.get('content-type')).toBe('text/css; charset=utf-8')
  })

  test('serves the version folder the route object names', async () => {
    const response = await serveWith({
      route: routeOf({ version: 7 }),
      files: [fixtureOf({ path: 'index.html', body: HTML, version: 7 })],
    })

    expect(response.status).toBe(200)
    expect(await response.text()).toBe(HTML)
  })

  test('does not read a file left in another version folder', async () => {
    const stale = fixtureOf({ path: 'index.html', body: '<!doctype html><title>stale</title>' })
    const stubbed = stubs({ files: [{ ...stale, version: 2 }] })
    const response = await respond({
      request: requestOf(),
      domain: DOMAIN,
      fetchRoute: stubbed.fetchRoute,
      fetchObject: stubbed.fetchObject,
    })

    expect(response.status).toBe(404)
    expect(stubbed.keys).toEqual([keyOf('index.html')])
  })

  test('serves a hashed asset', async () => {
    const response = await serveWith({ path: '/assets/app-1a2b3c4d.js' })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(APP_JS)
  })

  test('serves the SPA shell for a client route', async () => {
    const response = await serveWith({
      path: '/settings/profile',
      route: routeOf({ serve: { spa: true } }),
    })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(HTML)
  })

  test('serves the custom 404 file with a 404 status and no etag', async () => {
    const response = await serveWith({
      path: '/missing.js',
      route: routeOf({ serve: { spa: false, notFound: '404.html' } }),
    })
    expect(response.status).toBe(404)
    expect(await response.text()).toBe(MISSING_HTML)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('etag')).toBeNull()
  })

  test('answers the deployment not-found page', async () => {
    const response = await serveWith({ path: '/missing.js' })
    expect(response.status).toBe(404)
    expect(await response.text()).toContain('does not exist on this artifact')
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
    expect(stubbed.keys.every((key) => key.startsWith(keyOf('')))).toBe(true)
  })
})
