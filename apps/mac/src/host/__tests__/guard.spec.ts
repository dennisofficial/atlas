import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { once } from 'node:events'
import { connect, type ClientHttp2Session, type IncomingHttpHeaders } from 'node:http2'

import { createDesktopHost, type IDesktopHost } from '../index'

const SECRET = 'a'.repeat(64)
let host: IDesktopHost
let secure: ClientHttp2Session

beforeAll(async () => {
  host = await createDesktopHost({
    appOrigin: 'http://127.0.0.1:1',
    apiOrigin: 'http://127.0.0.1:1',
    secret: SECRET,
  })
  secure = connect(host.secureUrl, { rejectUnauthorized: false })
  secure.on('error', () => undefined)
  await once(secure, 'connect')
})

afterAll(async () => {
  secure.destroy()
  await host.stop()
})

async function secureGet({
  path,
  cookie,
  authority,
}: {
  path: string
  cookie?: string
  authority?: string
}): Promise<{ status: number; location?: string | undefined; headers: IncomingHttpHeaders }> {
  const stream = secure.request({
    ':path': path,
    ':method': 'GET',
    ...(authority === undefined ? {} : { ':authority': authority }),
    ...(cookie === undefined ? {} : { cookie }),
  })
  stream.on('data', () => undefined)
  const ended = once(stream, 'end')
  const [headers] = (await once(stream, 'response')) as [IncomingHttpHeaders, number]
  await ended
  const location = headers.location
  return {
    status: Number(headers[':status']),
    location: typeof location === 'string' ? location : undefined,
    headers,
  }
}

async function sessionCookie(): Promise<string> {
  const res = await fetch(`${host.url}/desktop/session?secret=${SECRET}`, { redirect: 'manual' })
  expect(res.status).toBe(302)
  expect(res.headers.get('location')).toBe('/')
  const setCookie = res.headers.get('set-cookie') ?? ''
  expect(setCookie).toContain('HttpOnly')
  expect(setCookie).toContain('SameSite=Strict')
  return setCookie.split(';')[0] ?? ''
}

describe('desktop guard', () => {
  test('session with wrong secret is 403', async () => {
    const res = await fetch(`${host.url}/desktop/session?secret=nope`, { redirect: 'manual' })
    expect(res.status).toBe(403)
  })

  test('no cookie is 403', async () => {
    expect((await fetch(`${host.url}/desktop/health`)).status).toBe(403)
  })

  test('provider sign-in routes require the desktop cookie', async () => {
    for (const action of ['start', 'status?attempt=one', 'stop']) {
      const response = await fetch(`${host.url}/desktop/provider-sign-in/${action}`, {
        method: action.startsWith('status') ? 'GET' : 'POST',
      })
      expect(response.status).toBe(403)
    }
  })

  test('refuses a change requested from another loopback port, even with the cookie', async () => {
    const cookie = await sessionCookie()
    const foreign = await fetch(`${host.url}/desktop/provider-sign-in/start`, {
      method: 'POST',
      headers: {
        cookie,
        origin: 'http://127.0.0.1:1',
        'sec-fetch-site': 'same-site',
        'content-type': 'text/plain',
      },
      body: JSON.stringify({ provider: 'anthropic' }),
    })
    const crossSite = await fetch(`${host.url}/desktop/provider-sign-in/stop`, {
      method: 'POST',
      headers: { cookie, 'sec-fetch-site': 'cross-site' },
      body: JSON.stringify({ attemptId: 'x' }),
    })
    const own = await fetch(`${host.url}/desktop/provider-sign-in/stop`, {
      method: 'POST',
      headers: { cookie, origin: host.url, 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({ attemptId: 'x' }),
    })

    expect(foreign.status).toBe(403)
    expect(crossSite.status).toBe(403)
    expect(own.status).toBe(204)
  })

  test('wrong cookie is 403', async () => {
    const res = await fetch(`${host.url}/desktop/health`, {
      headers: { cookie: 'atlas_desktop=wrong' },
    })
    expect(res.status).toBe(403)
  })

  test('good cookie and host passes', async () => {
    const cookie = await sessionCookie()
    const res = await fetch(`${host.url}/desktop/health`, { headers: { cookie } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  test('good cookie with a foreign Host header is 403', async () => {
    const cookie = await sessionCookie()
    const res = await fetch(`${host.url}/desktop/health`, {
      headers: { cookie, host: 'evil.example' },
    })
    expect(res.status).toBe(403)
  })

  test('unknown desktop route behind the guard is 404', async () => {
    const cookie = await sessionCookie()
    expect((await fetch(`${host.url}/desktop/nope`, { headers: { cookie } })).status).toBe(404)
  })
})

describe('the https listener', () => {
  test('is served next to the plain listener on its own port', () => {
    expect(host.secureUrl).toBe(`https://127.0.0.1:${host.securePort}`)
    expect(host.securePort).not.toBe(host.port)
    expect(host.certFingerprint).toStartWith('sha256/')
  })

  test('puts the session cookie on a redirect over HTTP/2', async () => {
    const reply = await secureGet({ path: `/desktop/session?secret=${SECRET}` })
    expect(reply.status).toBe(302)
    expect(reply.location).toBe('/')
    expect(String(reply.headers['set-cookie'])).toContain('HttpOnly')
  })

  test('passes the guard when the request names the https listener', async () => {
    const cookie = await sessionCookie()
    const reply = await secureGet({ path: '/desktop/health', cookie })
    expect(reply.status).toBe(200)
  })

  test('refuses a request whose authority names the plain listener', async () => {
    const cookie = await sessionCookie()
    const reply = await secureGet({
      path: '/desktop/health',
      cookie,
      authority: `127.0.0.1:${host.port}`,
    })
    expect(reply.status).toBe(403)
  })

  test('refuses a foreign authority', async () => {
    const cookie = await sessionCookie()
    const reply = await secureGet({ path: '/desktop/health', cookie, authority: 'evil.example' })
    expect(reply.status).toBe(403)
  })
})
