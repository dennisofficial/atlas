import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SESSION_COOKIE } from '../../guard'
import { createDesktopHost, type IDesktopHost } from '../../index'
import { createTokenStore } from '../token-store'

const SECRET = 'c'.repeat(64)
const HOME = mkdtempSync(join(tmpdir(), 'atlas-mac-auth-'))
const WEB = 'https://web.example.test'

let host: IDesktopHost
let upstream: ReturnType<typeof Bun.serve>
let opened: string[]
let exchanges: unknown[]
let exchangeStatus: number
let upstreamSeen: { path: string; authorization: string | null }[]
let seenProxy: Headers | undefined

beforeAll(() => {
  upstream = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      const path = new URL(request.url).pathname
      upstreamSeen.push({ path, authorization: request.headers.get('authorization') })
      if (path === '/v1/trpc/desktopAuth.exchange') {
        exchanges.push(await request.json())
        if (exchangeStatus !== 200) {
          return Response.json(
            { error: { message: 'bad', code: -32600, data: {} } },
            { status: exchangeStatus },
          )
        }
        return Response.json({ result: { data: { token: 'tok-1' } } })
      }
      if (path === '/api/auth/get-session') {
        return Response.json({ user: { email: 'd@example.com' } })
      }
      seenProxy = request.headers
      return Response.json({ ok: true })
    },
  })
  host = createDesktopHost({
    webRoot: '/nonexistent',
    secret: SECRET,
    apiOrigin: `http://127.0.0.1:${upstream.port}`,
    auth: {
      home: HOME,
      webOrigin: WEB,
      openExternal: (url) => {
        opened.push(url)
        return true
      },
    },
  })
})

afterAll(async () => {
  await host.stop()
  upstream.stop(true)
})

beforeEach(async () => {
  await call({ path: '/desktop/auth/sign-out', method: 'POST' })
  createTokenStore({ home: HOME }).clear()
  opened = []
  exchanges = []
  exchangeStatus = 200
  upstreamSeen = []
  seenProxy = undefined
})

const call = ({ path, method = 'GET' }: { path: string; method?: string }) =>
  fetch(`${host.url}${path}`, { method, headers: { cookie: `${SESSION_COOKIE}=${SECRET}` } })

const status = async (): Promise<{ state: string; email?: string }> =>
  (await call({ path: '/desktop/auth/status' })).json() as Promise<{
    state: string
    email?: string
  }>

const begin = async (): Promise<URL> => {
  await call({ path: '/desktop/auth/start', method: 'POST' })
  return new URL(opened[0] ?? '')
}

const callback = (query: string) => fetch(`${host.url}/desktop/auth/callback?${query}`)

describe('desktop auth', () => {
  test('requires the desktop guard', async () => {
    expect((await fetch(`${host.url}/desktop/auth/status`)).status).toBe(403)
  })

  test('idle without a token', async () => {
    expect(await status()).toEqual({ state: 'idle' })
  })

  test('start opens the web authorize page with loopback redirect and S256 challenge', async () => {
    const url = await begin()
    expect(`${url.origin}${url.pathname}`).toBe(`${WEB}/desktop/authorize`)
    expect(url.searchParams.get('redirect_uri')).toBe(`${host.url}/desktop/auth/callback`)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(url.searchParams.get('state')?.length).toBeGreaterThan(10)
    expect(await status()).toEqual({ state: 'pending' })
  })

  test('callback exchanges code with the verifier, stores the token, reports signed-in', async () => {
    const url = await begin()
    const state = url.searchParams.get('state') ?? ''
    const res = await callback(`code=abc&state=${state}`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Signed in')
    const sent = exchanges[0] as { code: string; codeVerifier: string; redirectUri: string }
    expect(sent.code).toBe('abc')
    expect(sent.redirectUri).toBe(`${host.url}/desktop/auth/callback`)
    expect(createHash('sha256').update(sent.codeVerifier).digest('base64url')).toBe(
      url.searchParams.get('code_challenge') ?? '',
    )
    expect(createTokenStore({ home: HOME }).token()).toBe('tok-1')
    expect(await status()).toEqual({ state: 'signed-in', email: 'd@example.com' })
  })

  test('callback rejects a wrong state without exchanging', async () => {
    await begin()
    const res = await callback('code=abc&state=nope')
    expect(res.status).toBe(400)
    expect(exchanges).toEqual([])
    expect(createTokenStore({ home: HOME }).token()).toBeUndefined()
  })

  test('callback rejects when no sign-in is pending and on replay', async () => {
    expect((await callback('code=abc&state=x')).status).toBe(400)
    const state = (await begin()).searchParams.get('state') ?? ''
    expect((await callback(`code=abc&state=${state}`)).status).toBe(200)
    expect((await callback(`code=abc&state=${state}`)).status).toBe(400)
    expect(exchanges).toHaveLength(1)
  })

  test('a failed exchange surfaces as denied', async () => {
    exchangeStatus = 400
    const state = (await begin()).searchParams.get('state') ?? ''
    expect((await callback(`code=abc&state=${state}`)).status).toBe(400)
    expect(await status()).toEqual({ state: 'denied' })
  })

  test('callback needs no guard cookie but a loopback Host; other /desktop paths stay guarded', async () => {
    const state = (await begin()).searchParams.get('state') ?? ''
    expect((await callback(`code=abc&state=${state}`)).status).toBe(200)
    expect((await fetch(`${host.url}/desktop/auth/callback/x`)).status).toBe(403)
    expect((await fetch(`${host.url}/desktop/auth/start`, { method: 'POST' })).status).toBe(403)
    const spoofed = await fetch(`${host.url}/desktop/auth/callback?code=a&state=b`, {
      headers: { host: 'evil.example:80' },
    })
    expect(spoofed.status).toBe(403)
  })

  test('sign-out clears the token and revokes it with the bearer', async () => {
    createTokenStore({ home: HOME }).save({ token: 'tok-2', email: 'a@b.c' })
    expect((await status()).state).toBe('signed-in')
    const res = await call({ path: '/desktop/auth/sign-out', method: 'POST' })
    expect(res.status).toBe(204)
    expect(await status()).toEqual({ state: 'idle' })
    expect(upstreamSeen).toEqual([{ path: '/api/auth/sign-out', authorization: 'Bearer tok-2' }])
  })
})

describe('proxy auth', () => {
  const proxied = () =>
    fetch(`${host.url}/api/thing`, {
      headers: { cookie: 'k=v', origin: `http://127.0.0.1:${host.port}` },
    })

  test('with a token injects the bearer and drops Cookie and Origin', async () => {
    createTokenStore({ home: HOME }).save({ token: 'tok-3' })
    await proxied()
    expect(seenProxy?.get('authorization')).toBe('Bearer tok-3')
    expect(seenProxy?.get('cookie')).toBeNull()
    expect(seenProxy?.get('origin')).toBeNull()
  })

  test('without a token keeps Cookie but drops Origin', async () => {
    await proxied()
    expect(seenProxy?.get('authorization')).toBeNull()
    expect(seenProxy?.get('cookie')).toBe('k=v')
    expect(seenProxy?.get('origin')).toBeNull()
  })
})
