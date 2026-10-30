import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createDesktopHost, type IDesktopHost } from '../index'

let upstream: ReturnType<typeof Bun.serve>
let host: IDesktopHost
let seen:
  | { method: string; url: string; body: string; host: string | null; cookie: string | null }
  | undefined

beforeAll(() => {
  upstream = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    idleTimeout: 0,
    async fetch(request) {
      const url = new URL(request.url)
      seen = {
        method: request.method,
        url: url.pathname + url.search,
        body: await request.text(),
        host: request.headers.get('host'),
        cookie: request.headers.get('cookie'),
      }
      if (url.pathname === '/api/cookies') {
        const headers = new Headers()
        headers.append(
          'Set-Cookie',
          '__Secure-better-auth.session_token=abc; Path=/; Secure; HttpOnly; SameSite=None',
        )
        headers.append('Set-Cookie', 'other=1; Path=/')
        return new Response('ok', { headers })
      }
      if (url.pathname === '/v1/events') {
        let n = 0
        const stream = new ReadableStream({
          async pull(controller) {
            if (n === 2) return controller.close()
            controller.enqueue(new TextEncoder().encode(`data: ${n}\n\n`))
            n += 1
            await Bun.sleep(150)
          },
        })
        return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
      }
      return Response.json({ echoed: true })
    },
  })
  host = createDesktopHost({
    webRoot: '/nonexistent',
    apiOrigin: `http://127.0.0.1:${upstream.port}`,
    secret: 's',
  })
})

afterAll(async () => {
  await host.stop()
  await upstream.stop(true)
})

describe('api proxy', () => {
  test('forwards method, body, query and rewrites Host', async () => {
    const res = await fetch(`${host.url}/api/thing?a=1&b=2`, {
      method: 'POST',
      body: JSON.stringify({ x: 1 }),
      headers: { cookie: 'k=v' },
    })
    expect(await res.json()).toEqual({ echoed: true })
    expect(seen).toMatchObject({
      method: 'POST',
      url: '/api/thing?a=1&b=2',
      body: '{"x":1}',
      host: `127.0.0.1:${upstream.port}`,
      cookie: 'k=v',
    })
  })

  test('passes every Set-Cookie through verbatim, names and attributes untouched', async () => {
    const res = await fetch(`${host.url}/api/cookies`)
    expect(res.headers.getSetCookie()).toEqual([
      '__Secure-better-auth.session_token=abc; Path=/; Secure; HttpOnly; SameSite=None',
      'other=1; Path=/',
    ])
  })

  test('streams SSE without buffering', async () => {
    const started = Date.now()
    const res = await fetch(`${host.url}/v1/events`)
    const reader = res.body!.getReader()
    const first = await reader.read()
    const firstAt = Date.now() - started
    expect(new TextDecoder().decode(first.value)).toBe('data: 0\n\n')
    expect(firstAt).toBeLessThan(140)
    const second = await reader.read()
    expect(new TextDecoder().decode(second.value)).toBe('data: 1\n\n')
    expect(res.headers.get('content-type')).toContain('text/event-stream')
  })

  test('returns 502 when the upstream is down', async () => {
    const dead = createDesktopHost({ webRoot: '/x', apiOrigin: 'http://127.0.0.1:1', secret: 's' })
    const res = await fetch(`${dead.url}/api/x`)
    expect(res.status).toBe(502)
    await dead.stop()
  })
})
