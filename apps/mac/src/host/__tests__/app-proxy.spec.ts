import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { createDesktopHost, type IDesktopHost } from '../index'

let app: ReturnType<typeof Bun.serve>
let host: IDesktopHost
let seen: { method: string; url: string; host: string | null; rsc: string | null } | undefined

beforeAll(() => {
  app = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    idleTimeout: 0,
    fetch(request) {
      const url = new URL(request.url)
      seen = {
        method: request.method,
        url: url.pathname + url.search,
        host: request.headers.get('host'),
        rsc: request.headers.get('rsc'),
      }
      if (url.pathname === '/threads/abc') {
        return new Response('<html>thread</html>', { headers: { 'content-type': 'text/html' } })
      }
      return new Response('missing', { status: 404 })
    },
  })
  host = createDesktopHost({ appOrigin: `http://127.0.0.1:${app.port}`, secret: 's' })
})

afterAll(async () => {
  await host.stop()
  await app.stop(true)
})

describe('app proxy', () => {
  test('serves a dynamic route document from the app server', async () => {
    const res = await fetch(`${host.url}/threads/abc`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('<html>thread</html>')
    expect(res.headers.get('content-type')).toBe('text/html')
    expect(seen).toMatchObject({
      method: 'GET',
      url: '/threads/abc',
      host: `127.0.0.1:${app.port}`,
    })
  })

  test('forwards the flight request and its query to the app server', async () => {
    await fetch(`${host.url}/threads/abc?_rsc=1`, { headers: { RSC: '1' } })
    expect(seen).toMatchObject({ url: '/threads/abc?_rsc=1', rsc: '1' })
  })

  test('keeps the desktop guard on host routes only', async () => {
    const guarded = await fetch(`${host.url}/desktop/health`)
    expect(guarded.status).toBe(403)
    const appRoute = await fetch(`${host.url}/threads/abc`)
    expect(appRoute.status).toBe(200)
  })

  test('returns 502 when the app server is down', async () => {
    const dead = createDesktopHost({ appOrigin: 'http://127.0.0.1:1', secret: 's' })
    const res = await fetch(`${dead.url}/threads/abc`)
    expect(res.status).toBe(502)
    await dead.stop()
  })
})
