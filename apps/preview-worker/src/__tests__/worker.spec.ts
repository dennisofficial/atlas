import { describe, expect, it } from 'bun:test'

import { handlePreviewRequest } from '../worker'
import { SCRIPT_SOURCE, scriptHash } from '../script'

const HOST = 'https://3000-abcdefghij.byatlas.dev'

function recorder(response: () => Response) {
  const seen: Request[] = []
  return {
    seen,
    upstream: async (request: Request) => {
      seen.push(request)
      return response()
    },
  }
}

async function run(args: { url: string; init?: RequestInit; response: () => Response }) {
  const { url, init, response } = args
  const upstream = recorder(response)
  const result = await handlePreviewRequest({
    request: new Request(url, init),
    upstream: upstream.upstream,
  })
  return { result, seen: upstream.seen }
}

describe('host gate', () => {
  it.each([
    'https://3000-abcdefghij.byatlas.dev.evil.com/',
    'https://evil.com/',
    'https://byatlas.dev/',
    'https://x.3000-abcdefghij.byatlas.dev/',
    'https://3000-abcdefghij.byatlas.dev@evil.com/',
    'https://evil.com/3000-abcdefghij.byatlas.dev',
    'https://3000-abcdefghi.byatlas.dev/',
    'https://3000-abcdefghij.byatlas.io/',
    'http://localhost:3000/',
  ])('answers 404 and never fetches %p', async (url) => {
    const { result, seen } = await run({ url, response: () => new Response('secret') })
    expect(result.status).toBe(404)
    expect(await result.text()).not.toContain('secret')
    expect(seen).toHaveLength(0)
  })

  it('never fetches for a Host header spoof on a non-matching url', async () => {
    const { result, seen } = await run({
      url: 'https://evil.com/',
      init: { headers: { host: '3000-abcdefghij.byatlas.dev' } },
      response: () => new Response('secret'),
    })
    expect(result.status).toBe(404)
    expect(seen).toHaveLength(0)
  })

  it('proxies a matching host once with the original request', async () => {
    const { result, seen } = await run({
      url: `${HOST}/api?x=1`,
      response: () => new Response('ok', { headers: { 'content-type': 'text/plain' } }),
    })
    expect(result.status).toBe(200)
    expect(await result.text()).toBe('ok')
    expect(seen).toHaveLength(1)
    expect(seen[0]?.url).toBe(`${HOST}/api?x=1`)
  })
})

describe('response headers', () => {
  it('drops X-Frame-Options and only the frame-ancestors directive', async () => {
    const { result } = await run({
      url: `${HOST}/`,
      response: () =>
        new Response('{}', {
          headers: {
            'content-type': 'application/json',
            'x-frame-options': 'DENY',
            'content-security-policy': "default-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
          },
        }),
    })
    expect(result.headers.get('x-frame-options')).toBeNull()
    expect(result.headers.get('content-security-policy')).toBe("default-src 'self' 'unsafe-inline'")
  })

  it('rewrites every Set-Cookie', async () => {
    const { result } = await run({
      url: `${HOST}/`,
      response: () => {
        const headers = new Headers({ 'content-type': 'application/json' })
        headers.append('set-cookie', 'a=1; SameSite=Lax; HttpOnly')
        headers.append('set-cookie', 'b=2')
        return new Response('{}', { headers })
      },
    })
    expect(result.headers.getSetCookie()).toEqual([
      'a=1; HttpOnly; Secure; Partitioned; SameSite=None',
      'b=2; Secure; Partitioned; SameSite=None',
    ])
  })

  it('leaves non-HTML bodies and content-length alone', async () => {
    const { result } = await run({
      url: `${HOST}/data.json`,
      response: () =>
        new Response('{"a":1}', {
          headers: { 'content-type': 'application/json', 'content-length': '7' },
        }),
    })
    expect(await result.text()).toBe('{"a":1}')
    expect(result.headers.get('content-length')).toBe('7')
  })
})

describe('html injection', () => {
  const html =
    (body: string, extra: Record<string, string> = {}) =>
    () =>
      new Response(body, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-length': String(body.length),
          ...extra,
        },
      })

  it('prepends the script to head and drops content-length', async () => {
    const { result } = await run({
      url: `${HOST}/`,
      response: html('<html><head><title>x</title></head><body>hi</body></html>'),
    })
    const text = await result.text()
    expect(text).toContain(`<head><script>${SCRIPT_SOURCE}</script><title>`)
    expect(text.match(/<script>/g)).toHaveLength(1)
    expect(result.headers.get('content-length')).toBeNull()
  })

  it('falls back to body when there is no head element', async () => {
    const { result } = await run({ url: `${HOST}/`, response: html('<body>hi</body>') })
    const text = await result.text()
    expect(text).toContain(`<body><script>${SCRIPT_SOURCE}</script>hi`)
  })

  it('adds the script hash to a restrictive CSP', async () => {
    const { result } = await run({
      url: `${HOST}/`,
      response: html('<head></head>', {
        'content-security-policy': "script-src 'self'; frame-ancestors 'none'",
      }),
    })
    expect(result.headers.get('content-security-policy')).toBe(
      `script-src 'self' ${await scriptHash()}`,
    )
  })
})

describe('websocket', () => {
  it('passes upgrades through untouched', async () => {
    const upstreamResponse = new Response('upgraded', {
      headers: { 'x-frame-options': 'DENY', 'content-type': 'text/html' },
    })
    const upstream = recorder(() => upstreamResponse)
    const result = await handlePreviewRequest({
      request: new Request(`${HOST}/hmr`, {
        headers: { upgrade: 'websocket', connection: 'Upgrade' },
      }),
      upstream: upstream.upstream,
    })
    expect(result).toBe(upstreamResponse)
    expect(upstream.seen).toHaveLength(1)
  })
})
