import { afterEach, describe, expect, it } from 'bun:test'

import { EAuthProvider } from '@dltech/atlas-core'
import { EOauthProvider } from '@dltech/atlas-wire'

import { createDesktopHost } from '../index'
import { SESSION_COOKIE } from '../guard'
import { trpcBodyOf } from './trpc-body'
import { createProviderSignInRoutes } from '../provider-sign-in-routes'

const PREFIX = '/desktop/provider-sign-in'
const cleanups: (() => void)[] = []
afterEach(() => {
  for (const stop of cleanups.splice(0)) stop()
})

const fixture = (args: { beginFails?: boolean; completeFails?: boolean; opens?: boolean } = {}) => {
  const redirects: string[] = []
  const opened: string[] = []
  const completed: { attemptId: string; code: string }[] = []
  const routes = createProviderSignInRoutes({
    begin: async ({ provider, redirectUri }) => {
      expect(provider).toBe(EOauthProvider.Anthropic)
      redirects.push(redirectUri)
      if (args.beginFails === true) throw new Error('api offline')
      return { attemptId: 'attempt-1', state: 'state-1', authorizeUrl: 'https://claude.test/auth' }
    },
    complete: async (input) => {
      completed.push(input)
      if (args.completeFails === true) throw new Error('exchange refused')
    },
    open: (url) => {
      opened.push(url)
      return args.opens ?? true
    },
  })
  cleanups.push(routes.stop)
  const request = async (args: { action: string; method?: string; body?: unknown }) => {
    const request = new Request(`http://127.0.0.1${PREFIX}/${args.action}`, {
      method: args.method ?? 'POST',
      ...(args.body === undefined ? {} : { body: JSON.stringify(args.body) }),
    })
    const response = await routes.handler(request, new URL(request.url).pathname)
    if (response === undefined) throw new Error('no route')
    return response
  }
  const start = () => request({ action: 'start', body: { provider: EOauthProvider.Anthropic } })
  const status = () => request({ action: 'status?attempt=attempt-1', method: 'GET' })
  const callback = (query: string) => {
    const redirect = new URL(redirects[0] ?? '')
    redirect.hostname = '127.0.0.1'
    redirect.search = query
    return fetch(redirect)
  }
  return { routes, request, start, status, callback, redirects, opened, completed }
}

describe('Mac provider sign-in routes', () => {
  it('binds before begin, opens the browser, and completes the code on the host', async () => {
    const f = fixture()
    const started = await f.start()
    expect(started.status).toBe(200)
    expect(await started.json()).toEqual({ attemptId: 'attempt-1' })
    const redirect = new URL(f.redirects[0] ?? '')
    expect(redirect.hostname).toBe('localhost')
    expect(Number(redirect.port)).toBeGreaterThan(0)
    expect(redirect.pathname).toBe('/callback')
    expect(f.opened).toEqual(['https://claude.test/auth'])
    expect(await (await f.status()).json()).toEqual({ state: 'pending' })

    await f.callback('state=state-1&code=the-code')
    expect(f.completed).toEqual([{ attemptId: 'attempt-1', code: 'the-code' }])
    expect(await (await f.status()).json()).toEqual({ state: 'signed-in' })
  })

  it('closes the listener on stop and records cancellation', async () => {
    const f = fixture()
    await f.start()
    const stopped = await f.request({ action: 'stop', body: { attemptId: 'attempt-1' } })
    expect(stopped.status).toBe(204)
    await expect(f.callback('state=state-1&code=late-code')).rejects.toBeDefined()
    expect(await (await f.status()).json()).toEqual({ state: 'cancelled' })
    expect(f.completed).toEqual([])
  })

  it('signals fallback and closes its listener when begin fails', async () => {
    const f = fixture({ beginFails: true })
    const response = await f.start()
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ fallback: true, reason: 'api offline' })
    await expect(f.callback('state=state-1&code=late-code')).rejects.toBeDefined()
    expect(f.opened).toEqual([])
  })

  it('signals fallback when the browser cannot open', async () => {
    const f = fixture({ opens: false })
    const response = await f.start()
    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ fallback: true })
    await expect(f.callback('state=state-1&code=late-code')).rejects.toBeDefined()
  })

  it('records a provider refusal without exchanging a code', async () => {
    const f = fixture()
    await f.start()
    await f.callback('state=state-1&error=access_denied')
    expect(await (await f.status()).json()).toEqual({ state: 'failed', reason: 'access_denied' })
    expect(f.completed).toEqual([])
  })

  it('records an exchange failure', async () => {
    const f = fixture({ completeFails: true })
    await f.start()
    await f.callback('state=state-1&code=the-code')
    expect(await (await f.status()).json()).toEqual({ state: 'failed', reason: 'exchange refused' })
  })

  it('wires the guarded host routes to the API with the host bearer', async () => {
    const seen: { path: string; authorization: string | null; body: unknown }[] = []
    const opened: string[] = []
    let receivedComplete: () => void = () => {}
    const completed = new Promise<void>((resolve) => {
      receivedComplete = resolve
    })
    let redirectUri = ''
    const upstream = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: async (request) => {
        const path = new URL(request.url).pathname
        if (!path.includes('providerSignIn.')) return Response.json({ result: { data: {} } })
        const body = await trpcBodyOf(request)
        seen.push({ path, authorization: request.headers.get('authorization'), body })
        if (path.endsWith('.begin')) {
          if (
            typeof body === 'object' &&
            body !== null &&
            'redirectUri' in body &&
            typeof body.redirectUri === 'string'
          )
            redirectUri = body.redirectUri
          return Response.json({
            result: {
              data: {
                flow: 'loopback',
                attemptId: 'host-attempt',
                authorizeUrl: 'https://claude.test/auth',
                state: 'host-state',
                expiresInMs: 60000,
              },
            },
          })
        }
        receivedComplete()
        return Response.json({ result: { data: {} } })
      },
    })
    const secret = 's'.repeat(64)
    const host = await createDesktopHost({
      apiOrigin: `http://127.0.0.1:${upstream.port}`,
      appOrigin: 'http://127.0.0.1:1',
      secret,
      auth: {
        store: {
          token: () => 'host-bearer',
          email: () => 'host@example.test',
          deviceId: () => 'device',
          save: () => {},
          saveDeviceId: () => {},
          clear: () => {},
        },
      },
      openExternal: (url) => {
        opened.push(url)
        return true
      },
    })
    try {
      const response = await fetch(`${host.url}${PREFIX}/start`, {
        method: 'POST',
        headers: { cookie: `${SESSION_COOKIE}=${secret}` },
        body: JSON.stringify({ provider: EOauthProvider.Anthropic }),
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ attemptId: 'host-attempt' })
      expect(opened).toEqual(['https://claude.test/auth'])
      expect(seen[0]).toMatchObject({
        path: '/v1/trpc/providerSignIn.begin',
        authorization: 'Bearer host-bearer',
        body: { provider: 'anthropic', flow: 'loopback', redirectUri },
      })
      const callback = new URL(redirectUri)
      callback.hostname = '127.0.0.1'
      callback.search = 'state=host-state&code=host-code'
      await fetch(callback)
      await completed
      expect(seen[1]).toMatchObject({
        path: '/v1/trpc/providerSignIn.complete',
        authorization: 'Bearer host-bearer',
        body: { attemptId: 'host-attempt', code: 'host-code' },
      })
    } finally {
      await host.stop()
      await upstream.stop(true)
    }
  })

  it('rejects invalid bodies and unknown attempts', async () => {
    const f = fixture()
    expect(
      (await f.request({ action: 'start', body: { provider: EAuthProvider.OpenRouter } })).status,
    ).toBe(400)
    expect((await f.request({ action: 'start', body: 'bad' })).status).toBe(400)
    expect((await f.status()).status).toBe(404)
    expect((await f.request({ action: 'stop', body: {} })).status).toBe(400)
  })
})
