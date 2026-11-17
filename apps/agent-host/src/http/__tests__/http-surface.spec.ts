import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import {
  AUTHORIZE_URL,
  startHttpApp,
  TOKEN,
  TRUSTED_ORIGIN,
  USER,
  type RunningHttpApp,
} from './http-app'

const EVIL_ORIGIN = 'https://evil.example'
const ANSWER_PATH = '/operator-requests/answer'
const BEGIN_PATH = '/mcp-oauth/begin'
const CALLBACK_PATH = '/mcp-oauth/callback'
const BODY = { sessionId: 'ses_1', callId: 'call_1', value: 'yes' }

const jsonOf = async (response: Response): Promise<unknown> => await response.json()

const preflight = (args: {
  app: RunningHttpApp
  path: string
  origin: string
}): Promise<Response> =>
  fetch(`${args.app.url}${args.path}`, {
    method: 'OPTIONS',
    headers: {
      origin: args.origin,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'authorization, content-type',
    },
  })

const post = (args: {
  app: RunningHttpApp
  path?: string
  body?: unknown
  bearer?: string
  origin?: string
  method?: string
}): Promise<Response> =>
  fetch(`${args.app.url}${args.path ?? ANSWER_PATH}`, {
    method: args.method ?? 'POST',
    headers: {
      'content-type': 'application/json',
      ...(args.bearer === undefined ? {} : { authorization: `Bearer ${args.bearer}` }),
      ...(args.origin === undefined ? {} : { origin: args.origin }),
    },
    body: JSON.stringify(args.body ?? BODY),
  })

describe('the agent host http surface', () => {
  let app: RunningHttpApp

  beforeAll(async () => {
    app = await startHttpApp({ trustedOrigins: [TRUSTED_ORIGIN] })
  })

  afterAll(async () => {
    await app.close()
  })

  it('answers a preflight from a trusted origin on both posted routes with the old headers', async () => {
    for (const path of [ANSWER_PATH, BEGIN_PATH]) {
      const response = await preflight({ app, path, origin: TRUSTED_ORIGIN })

      expect(response.status).toBe(204)
      expect(response.headers.get('access-control-allow-origin')).toBe(TRUSTED_ORIGIN)
      expect(response.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS')
      expect(response.headers.get('access-control-allow-headers')).toBe(
        'authorization, content-type',
      )
      expect(response.headers.get('access-control-max-age')).toBe('600')
      expect(response.headers.get('vary')?.toLowerCase()).toContain('origin')
    }
  })

  it('answers a preflight from an untrusted origin with no allow origin on both routes', async () => {
    for (const path of [ANSWER_PATH, BEGIN_PATH]) {
      const response = await preflight({ app, path, origin: EVIL_ORIGIN })

      expect(response.status).toBe(204)
      expect(response.headers.get('access-control-allow-origin')).toBeNull()
    }
  })

  it('refuses a missing bearer, an unknown bearer and an untrusted origin on both routes', async () => {
    const allowed = { app, origin: TRUSTED_ORIGIN }
    for (const path of [ANSWER_PATH, BEGIN_PATH]) {
      const missing = await post({ ...allowed, path })
      const unknown = await post({ ...allowed, path, bearer: 'nobody' })
      const evil = await post({ ...allowed, path, bearer: TOKEN, origin: EVIL_ORIGIN })

      expect(missing.status).toBe(401)
      expect(await jsonOf(missing)).toEqual({ reason: 'bearer' })
      expect(unknown.status).toBe(401)
      expect(evil.status).toBe(403)
      expect(await jsonOf(evil)).toEqual({ reason: 'origin' })
    }
  })

  it('refuses a request that carries no origin once trusted origins are configured', async () => {
    const response = await post({ app, bearer: TOKEN })

    expect(response.status).toBe(403)
    expect(await jsonOf(response)).toEqual({ reason: 'origin' })
  })

  it('answers 400 for a body neither schema accepts', async () => {
    const answer = await post({
      app,
      body: { requestId: 'oreq_1', value: 'yes' },
      bearer: TOKEN,
      origin: TRUSTED_ORIGIN,
    })
    const begin = await post({
      app,
      path: BEGIN_PATH,
      body: { serverId: 'srv-1' },
      bearer: TOKEN,
      origin: TRUSTED_ORIGIN,
    })

    expect(answer.status).toBe(400)
    expect(await jsonOf(answer)).toEqual({ reason: 'body' })
    expect(begin.status).toBe(400)
    expect(await jsonOf(begin)).toEqual({ reason: 'body' })
  })

  it('answers 405 for a method the route does not serve', async () => {
    for (const path of [ANSWER_PATH, BEGIN_PATH]) {
      const response = await fetch(`${app.url}${path}`)

      expect(response.status).toBe(405)
      expect(await jsonOf(response)).toEqual({ reason: 'method' })
    }
  })

  it('hands an answered operator request the bearer user on the request', async () => {
    const response = await post({ app, bearer: TOKEN, origin: TRUSTED_ORIGIN })

    expect(response.status).toBe(200)
    expect(await jsonOf(response)).toEqual({})
    expect(app.fakes.answered).toEqual([{ userId: USER, body: BODY }])
  })

  it('starts an mcp oauth begin for the bearer user', async () => {
    const response = await post({
      app,
      path: BEGIN_PATH,
      body: { serverId: 'srv-1', surface: 'web', screen: { kind: 'settings', scope: 'user' } },
      bearer: TOKEN,
      origin: TRUSTED_ORIGIN,
    })

    expect(response.status).toBe(200)
    expect(await jsonOf(response)).toEqual({ url: AUTHORIZE_URL })
    expect(app.fakes.begun.map((call) => call.userId)).toEqual([USER])
  })

  it('redirects a callback with state and renders the page without it', async () => {
    const redirect = await fetch(`${app.url}${CALLBACK_PATH}?state=abc`, { redirect: 'manual' })
    const page = await fetch(`${app.url}${CALLBACK_PATH}`)

    expect(redirect.status).toBe(302)
    expect(redirect.headers.get('location')).toContain('mcpOauth=connected')
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type')).toContain('text/html')
    expect(await page.text()).toContain('<p>connected</p>')
  })

  it('refuses a plain get on the stream path with 426', async () => {
    const response = await fetch(`${app.url}/stream`)

    expect(response.status).toBe(426)
    expect(await response.text()).toBe('upgrade required')
  })

  it('answers an unknown path with 404', async () => {
    const response = await fetch(`${app.url}/nope`)

    expect(response.status).toBe(404)
  })

  it('reports healthy until the drain starts and unhealthy while draining', async () => {
    const before = await fetch(`${app.url}/healthz`)
    expect(before.status).toBe(200)
    expect(await jsonOf(before)).toEqual({ ok: true, connections: 0 })

    await app.drain()

    const during = await fetch(`${app.url}/healthz`)
    expect(during.status).toBe(503)
    expect(await jsonOf(during)).toEqual({ ok: false, connections: 0 })
  })
})

describe('the agent host http surface with no trusted origins', () => {
  let app: RunningHttpApp

  beforeAll(async () => {
    app = await startHttpApp({ trustedOrigins: [] })
  })

  afterAll(async () => {
    await app.close()
  })

  it('allows any origin and a request with none at all', async () => {
    const options = await preflight({ app, path: ANSWER_PATH, origin: EVIL_ORIGIN })
    const answered = await post({ app, bearer: TOKEN })

    expect(options.status).toBe(204)
    expect(options.headers.get('access-control-allow-origin')).toBe(EVIL_ORIGIN)
    expect(answered.status).toBe(200)
  })
})
