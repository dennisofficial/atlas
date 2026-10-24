import type { NestExpressApplication } from '@nestjs/platform-express'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { FakeStore, grantOf } from './oauth-connections.fakes'
import {
  createOauthApp,
  mutate,
  oauthProviders,
  principalSandboxes,
  query,
  SANDBOX_PRINCIPALS,
  START,
} from './oauth-connections.router.fixture'

describe('OauthConnectionsRouter authorization', () => {
  let app: NestExpressApplication
  let store: FakeStore

  const upload = (token: string | undefined, connectionId = 'conn-1') =>
    mutate({
      app,
      procedure: 'oauthConnections.upload',
      token,
      body: { connectionId, provider: 'anthropic', tokens: grantOf(START) },
    })
  const mint = (token: string | undefined, body: object = { connectionId: 'conn-1' }) =>
    mutate({ app, procedure: 'oauthConnections.accessToken', token, body })
  const assign = (token: string | undefined, threadId: string) =>
    mutate({
      app,
      procedure: 'oauthConnections.assignSandbox',
      token,
      body: { connectionId: 'conn-1', threadId },
    })
  const remove = (token: string | undefined) =>
    mutate({
      app,
      procedure: 'oauthConnections.remove',
      token,
      body: { connectionId: 'conn-1' },
    })
  const metadata = (token: string | undefined) =>
    query({
      app,
      procedure: 'oauthConnections.get',
      token,
      input: { connectionId: 'conn-1' },
    })
  const reauthorize = (token: string | undefined, body: object) =>
    mutate({ app, procedure: 'oauthConnections.reauthorize', token, body })

  beforeEach(async () => {
    store = new FakeStore()
    store.sandboxes.set('thread-1', { id: 'sbx-1', userId: 'user-a' })
    store.sandboxes.set('thread-2', { id: 'sbx-2', userId: 'user-a' })
    app = await createOauthApp(
      oauthProviders({
        store,
        sandboxes: principalSandboxes({ principals: SANDBOX_PRINCIPALS }),
      }),
    )
  })

  afterEach(() => app.close())

  it('rejects an unauthenticated caller on every procedure', async () => {
    expect((await upload(undefined)).status).toBe(401)
    expect((await mint(undefined)).status).toBe(401)
    expect((await assign(undefined, 'thread-1')).status).toBe(401)
    expect((await remove(undefined)).status).toBe(401)
    expect((await metadata(undefined)).status).toBe(401)
  })

  it('exposes only owned authorization metadata, not tokens or sandbox access', async () => {
    expect((await upload('session-a')).status).toBe(200)
    const response = await metadata('session-a')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      result: { data: { provider: 'anthropic', authorizationId: 'conn-1', generation: 0 } },
    })
    expect(response.headers['cache-control']).toBe('no-store')
    expect((await metadata('session-b')).status).toBe(404)
    expect((await metadata('sandbox-token-1')).status).toBe(401)
  })

  it('keeps upload, assignment and deletion session-only', async () => {
    expect((await upload('session-a')).status).toBe(200)
    expect((await upload('sandbox-token-1')).status).toBe(401)
    expect((await assign('sandbox-token-1', 'thread-1')).status).toBe(401)
    expect((await remove('sandbox-token-1')).status).toBe(401)
    expect(store.rows.has('conn-1')).toBe(true)
  })

  it('refuses a malformed expiry before persisting a grant', async () => {
    const response = await mutate({
      app,
      procedure: 'oauthConnections.upload',
      token: 'session-a',
      body: {
        connectionId: 'conn-1',
        provider: 'anthropic',
        tokens: { ...grantOf(START), expiresAt: 'not-a-date' },
      },
    })
    expect(response.status).toBe(400)
    expect(store.rows.has('conn-1')).toBe(false)
  })

  it('accepts the instants clients send from toISOString()', async () => {
    const response = await mutate({
      app,
      procedure: 'oauthConnections.upload',
      token: 'session-a',
      body: {
        connectionId: 'conn-1',
        provider: 'anthropic',
        tokens: { ...grantOf(START), expiresAt: new Date(START + 1000).toISOString() },
      },
    })
    expect(response.status).toBe(200)
  })

  it('issues access-only, uncacheable answers to the owning session', async () => {
    const created = await upload('session-a')
    expect(created.status).toBe(200)
    expect(created.headers['cache-control']).toBe('no-store')
    const issued = await mint('session-a')
    expect(issued.status).toBe(200)
    expect(issued.headers['cache-control']).toBe('no-store')
    expect(JSON.stringify([created.body, issued.body])).not.toContain('refresh-0')
    expect(issued.body.result.data).toMatchObject({ accessToken: 'access-0', generation: 0 })
    expect(issued.body.result.data).not.toHaveProperty('providerAccountId')
  })

  it('hides a connection from another user', async () => {
    await upload('session-a')
    expect((await upload('session-b')).status).toBe(404)
    expect((await mint('session-b')).status).toBe(404)
    expect((await assign('session-b', 'thread-1')).status).toBe(404)
    expect((await remove('session-b')).status).toBe(404)
  })

  it('lets only an assigned sandbox mint access tokens', async () => {
    await upload('session-a')

    expect((await mint('sandbox-token-1')).status).toBe(404)
    expect((await assign('session-a', 'thread-1')).status).toBe(200)
    expect((await mint('sandbox-token-1')).status).toBe(200)
    expect((await mint('sandbox-token-2')).status).toBe(404)
    expect((await mint('sandbox-token-unknown')).status).toBe(401)
  })

  it('reauthorizes on the same connection for the session only and surfaces authorizationId', async () => {
    await upload('session-a')
    const body = (to: string, from: string) => ({
      connectionId: 'conn-1',
      provider: 'anthropic',
      tokens: grantOf(START),
      authorizationId: to,
      previousAuthorizationId: from,
    })

    expect((await reauthorize('sandbox-token-1', body('auth-2', 'conn-1'))).status).toBe(401)
    expect((await reauthorize('session-b', body('auth-2', 'conn-1'))).status).toBe(404)
    const done = await reauthorize('session-a', body('auth-2', 'conn-1'))
    expect(done.status).toBe(200)
    expect(done.headers['cache-control']).toBe('no-store')
    expect(done.body.result.data).toMatchObject({ authorizationId: 'auth-2', generation: 1 })
    expect((await reauthorize('session-a', body('auth-2', 'conn-1'))).status).toBe(200)
    expect((await reauthorize('session-a', body('auth-3', 'conn-1'))).status).toBe(409)
    const { authorizationId: _a, previousAuthorizationId: _p, ...incomplete } = body('x', 'y')
    expect((await reauthorize('session-a', incomplete)).status).toBe(400)
  })

  it('refuses to assign a sandbox that does not exist yet', async () => {
    await upload('session-a')
    expect((await assign('session-a', 'thread-9')).status).toBe(404)
  })

  it('rejects unknown input fields and unsupported providers', async () => {
    const provider = await mutate({
      app,
      procedure: 'oauthConnections.upload',
      token: 'session-a',
      body: { connectionId: 'conn-1', provider: 'openrouter', tokens: grantOf(START) },
    })
    expect(provider.status).toBe(400)
    expect((await mint('session-a', { connectionId: 'conn-1', refreshToken: 'x' })).status).toBe(
      400,
    )
  })

  it('reports a removed connection as gone and deletes it for its owner', async () => {
    await upload('session-a')
    expect((await remove('session-a')).status).toBe(200)
    expect(store.rows.has('conn-1')).toBe(false)
    expect((await remove('session-a')).status).toBe(404)
  })
})
