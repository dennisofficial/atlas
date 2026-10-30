import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ECloudLoginPoll,
  type CloudLoginOutcome,
  type CloudLoginTicket,
} from '@dltech/atlas-harness'
import { SESSION_COOKIE } from '../../guard'
import { createDesktopHost, type IDesktopHost } from '../../index'
import { createTokenStore } from '../token-store'

const SECRET = 'c'.repeat(64)
const HOME = mkdtempSync(join(tmpdir(), 'atlas-mac-auth-'))
const TICKET: CloudLoginTicket = {
  url: 'http://x',
  deviceCode: 'dc',
  userCode: 'ABCD-1234',
  verificationUrl: 'https://byatlas.io/device?user_code=ABCD-1234',
  expiresInMs: 600_000,
  intervalMs: 1,
}

let host: IDesktopHost
let upstream: ReturnType<typeof Bun.serve>
let opened: string[]
let outcomes: CloudLoginOutcome[]
let upstreamSeen: { path: string; authorization: string | null }[]
let seenProxy: Headers | undefined

beforeAll(() => {
  upstream = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(request) {
      const path = new URL(request.url).pathname
      upstreamSeen.push({ path, authorization: request.headers.get('authorization') })
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
      openExternal: (url) => {
        opened.push(url)
        return true
      },
      begin: async () => TICKET,
      poll: async () => outcomes.shift() ?? { status: ECloudLoginPoll.Pending },
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
  outcomes = []
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

const until = async (predicate: () => Promise<boolean>) => {
  for (let i = 0; i < 200; i += 1) {
    if (await predicate()) return
    await Bun.sleep(5)
  }
}

describe('desktop auth', () => {
  test('requires the desktop guard', async () => {
    expect((await fetch(`${host.url}/desktop/auth/status`)).status).toBe(403)
  })

  test('idle without a token', async () => {
    expect(await status()).toEqual({ state: 'idle' })
  })

  test('start opens the browser, polls, stores the token and reports signed-in', async () => {
    outcomes = [
      { status: ECloudLoginPoll.Pending },
      { status: ECloudLoginPoll.Approved, token: 'tok-1' },
    ]
    const res = await call({ path: '/desktop/auth/start', method: 'POST' })
    expect(await res.json()).toEqual({
      userCode: TICKET.userCode,
      verificationUrl: TICKET.verificationUrl,
    })
    expect(opened).toEqual([TICKET.verificationUrl])
    await until(async () => (await status()).state === 'signed-in')
    expect(await status()).toEqual({ state: 'signed-in', email: 'd@example.com' })
    expect(createTokenStore({ home: HOME }).token()).toBe('tok-1')
    expect(upstreamSeen[0]).toEqual({
      path: '/api/auth/get-session',
      authorization: 'Bearer tok-1',
    })
  })

  test('denied and expired outcomes surface', async () => {
    outcomes = [{ status: ECloudLoginPoll.Denied }]
    await call({ path: '/desktop/auth/start', method: 'POST' })
    await until(async () => (await status()).state === 'denied')
    expect(await status()).toEqual({ state: 'denied' })
    outcomes = [{ status: ECloudLoginPoll.Expired }]
    await call({ path: '/desktop/auth/start', method: 'POST' })
    await until(async () => (await status()).state === 'expired')
    expect(await status()).toEqual({ state: 'expired' })
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
