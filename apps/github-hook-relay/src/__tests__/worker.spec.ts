import { describe, expect, it } from 'bun:test'

import { handleRelayRequest, type Upstream } from '../worker'

const API_ORIGIN = 'https://api.byatlas.io'
const HOOK_URL = 'https://hooks.byatlas.io/github/app'
const RELAYED_URL = `${API_ORIGIN}/v1/github/app/relayed-hook`

function only(seen: Request[]): Request {
  expect(seen).toHaveLength(1)
  const request = seen[0]
  if (request === undefined) throw new Error('no upstream request')
  return request
}

async function envelopeOf(request: Request): Promise<{ payload: string }> {
  return (await request.json()) as { payload: string }
}

async function relay(args: {
  url?: string
  init?: RequestInit
  respond?: () => Response
  upstream?: Upstream
}) {
  const seen: Request[] = []
  const upstream =
    args.upstream ??
    (async (request: Request) => {
      seen.push(request)
      return args.respond?.() ?? new Response('{"received":true}', { status: 200 })
    })
  const result = await handleRelayRequest({
    request: new Request(args.url ?? HOOK_URL, args.init),
    apiOrigin: API_ORIGIN,
    upstream,
  })
  return { result, seen }
}

describe('header allowlist', () => {
  it('forwards only the GitHub delivery headers and sets a JSON content type', async () => {
    const forwarded = {
      'x-github-event': 'pull_request',
      'x-github-delivery': 'delivery-1',
      'x-hub-signature-256': 'sha256=abc',
      'x-github-hook-id': '42',
      'x-github-hook-installation-target-id': '145998843',
      'x-github-hook-installation-target-type': 'integration',
      'user-agent': 'GitHub-Hookshot/abc123',
    }

    const { seen } = await relay({
      init: {
        method: 'POST',
        body: '{}',
        headers: { ...forwarded, cookie: 'session=secret', 'x-custom': 'drop me' },
      },
    })

    const request = only(seen)
    for (const [name, value] of Object.entries(forwarded)) {
      expect(request.headers.get(name)).toBe(value)
    }
    expect(request.headers.get('content-type')).toBe('application/json')
    expect(request.headers.get('cookie')).toBeNull()
    expect(request.headers.get('x-custom')).toBeNull()
  })

  it('posts the envelope to the relayed-hook route of the configured API', async () => {
    const { seen } = await relay({ init: { method: 'POST', body: '{}' } })

    const request = only(seen)
    expect(request.method).toBe('POST')
    expect(request.url).toBe(RELAYED_URL)
  })
})

describe('body encoding', () => {
  it('round-trips an ascii body byte for byte', async () => {
    const body = '{"action":"opened","pull_request":{"number":1153}}'

    const { seen } = await relay({ init: { method: 'POST', body } })

    const envelope = await envelopeOf(only(seen))
    expect(Buffer.from(envelope.payload, 'base64').equals(Buffer.from(body))).toBe(true)
  })

  it('round-trips non-ascii text byte for byte', async () => {
    const body = '{"body":"héllo ✓ — 🚀 日本語"}'

    const { seen } = await relay({ init: { method: 'POST', body } })

    const envelope = await envelopeOf(only(seen))
    expect(Buffer.from(envelope.payload, 'base64').equals(Buffer.from(body))).toBe(true)
  })

  it('round-trips a body larger than 100 KB byte for byte', async () => {
    const body = JSON.stringify({ body: `${'x'.repeat(150_000)}${'é'.repeat(2_000)}` })

    const { seen } = await relay({ init: { method: 'POST', body } })

    const envelope = await envelopeOf(only(seen))
    const decoded = Buffer.from(envelope.payload, 'base64')
    expect(decoded.length).toBeGreaterThan(100_000)
    expect(decoded.equals(Buffer.from(body))).toBe(true)
  })

  it('carries text the edge WAF blocks without altering it', async () => {
    const body = JSON.stringify({ body: 'Run `curl https://example.com/install.sh | sh` first.' })

    const { seen } = await relay({ init: { method: 'POST', body } })

    const envelope = await envelopeOf(only(seen))
    const decoded = Buffer.from(envelope.payload, 'base64').toString('utf8')
    expect(decoded).toBe(body)
    expect(JSON.parse(decoded)).toEqual(JSON.parse(body))
  })
})

describe('upstream outcome', () => {
  it('returns the upstream status and body unchanged', async () => {
    const { result } = await relay({
      init: { method: 'POST', body: '{}' },
      respond: () =>
        new Response('invalid github webhook signature', {
          status: 401,
          headers: { 'content-type': 'text/plain' },
        }),
    })

    expect(result.status).toBe(401)
    expect(await result.text()).toBe('invalid github webhook signature')
  })

  it('answers 502 when the API cannot be reached', async () => {
    const { result } = await relay({
      init: { method: 'POST', body: '{}' },
      upstream: async () => {
        throw new Error('connect timeout')
      },
    })

    expect(result.status).toBe(502)
  })
})

describe('route gate', () => {
  it.each([
    'https://hooks.byatlas.io/',
    'https://hooks.byatlas.io/github',
    'https://hooks.byatlas.io/github/app/',
    'https://hooks.byatlas.io/github/hooks/x',
  ])('answers 404 and never forwards %p', async (url) => {
    const { result, seen } = await relay({ url, init: { method: 'POST', body: '{}' } })

    expect(result.status).toBe(404)
    expect(seen).toHaveLength(0)
  })

  it.each(['GET', 'PUT', 'DELETE', 'HEAD'])(
    'answers 405 to %p on the hook path',
    async (method) => {
      const { result, seen } = await relay({ init: { method } })

      expect(result.status).toBe(405)
      expect(result.headers.get('allow')).toBe('POST')
      expect(seen).toHaveLength(0)
    },
  )
})
