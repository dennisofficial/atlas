import { describe, expect, test } from 'bun:test'

import { APP_JS, HTML, MISSING_HTML, routeOf, serveWith } from './respond-fixtures'

describe('respond caching', () => {
  test('revalidates an unhashed document on every load, with an etag', async () => {
    const response = await serveWith()
    expect(response.headers.get('cache-control')).toBe('no-cache')
    expect(response.headers.get('etag')).toBeString()
    expect(response.headers.get('cdn-cache-control')).toBeNull()
  })

  test('caches a hashed path for a year, immutable', async () => {
    const response = await serveWith({ path: '/assets/app-1a2b3c4d.js' })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(APP_JS)
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(response.headers.get('cdn-cache-control')).toBeNull()
  })

  test('answers 304 with the same etag when If-None-Match matches', async () => {
    const first = await serveWith()
    const etag = first.headers.get('etag') ?? ''
    await first.body?.cancel()

    const response = await serveWith({ headers: { 'if-none-match': etag } })
    expect(response.status).toBe(304)
    expect(await response.text()).toBe('')
    expect(response.headers.get('etag')).toBe(etag)
    expect(response.headers.get('cache-control')).toBe('no-cache')
  })

  test('answers 304 for a wildcard If-None-Match', async () => {
    const response = await serveWith({ headers: { 'if-none-match': '*' } })
    expect(response.status).toBe(304)
    expect(response.body).toBeNull()
  })

  test('serves the body when If-None-Match names another etag', async () => {
    const response = await serveWith({ headers: { 'if-none-match': '"stale"' } })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(HTML)
    expect(response.headers.get('etag')).toBeString()
  })

  test('ignores If-None-Match on the custom 404 file', async () => {
    const response = await serveWith({
      path: '/missing.js',
      route: routeOf({ serve: { spa: false, notFound: '404.html' } }),
      headers: { 'if-none-match': '*' },
    })
    expect(response.status).toBe(404)
    expect(await response.text()).toBe(MISSING_HTML)
    expect(response.headers.get('etag')).toBeNull()
  })

  test('answers HEAD with the same status and headers, without a body', async () => {
    const response = await serveWith({ method: 'HEAD' })
    expect(response.status).toBe(200)
    expect(response.body).toBeNull()
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-cache')
    expect(response.headers.get('etag')).toBeString()
  })

  test('answers HEAD on a missing path without a body', async () => {
    const response = await serveWith({ method: 'HEAD', path: '/missing.js' })
    expect(response.status).toBe(404)
    expect(response.body).toBeNull()
  })

  test('keeps the 200 status for a HEAD with a matching If-None-Match', async () => {
    const first = await serveWith()
    const etag = first.headers.get('etag') ?? ''
    await first.body?.cancel()

    const response = await serveWith({ method: 'HEAD', headers: { 'if-none-match': etag } })
    expect(response.status).toBe(200)
    expect(response.body).toBeNull()
  })
})
