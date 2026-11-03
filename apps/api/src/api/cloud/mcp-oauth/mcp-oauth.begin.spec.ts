import { describe, expect, it } from 'bun:test'
import { EMcpOauthBeginOutcome } from '@dltech/atlas-wire'
import { AUTH, SERVER, TEST_CONFIG, installIssuer, json } from './mcp-oauth.fakes'
import { addCloudServer, build, seedGrant } from './mcp-oauth.testkit'

describe('McpOauthService.begin', () => {
  const beginFor = async (
    env: ReturnType<typeof build>,
    server: { id: string },
    returnTo?: string,
  ) =>
    env.oauth.begin({
      userId: 'user-a',
      serverId: server.id,
      ...(returnTo === undefined ? {} : { returnTo }),
    })

  it('registers a client and returns an authorization url pinned to the resource', async () => {
    const env = build()
    const server = await addCloudServer(env)
    const result = await beginFor(env, server)
    if (result.outcome !== EMcpOauthBeginOutcome.Redirect) throw new Error('expected redirect')
    const url = new URL(result.authorizationUrl)
    expect(url.origin).toBe(AUTH)
    expect(url.searchParams.get('client_id')).toBe('client-1')
    expect(url.searchParams.get('redirect_uri')).toBe(TEST_CONFIG.redirectUri)
    expect(url.searchParams.get('resource')).toBe(SERVER)
    expect(url.searchParams.get('scope')).toBe('read')
    expect(env.store.pendings.size).toBe(1)
    const pending = [...env.store.pendings.values()][0]
    expect(pending?.mcpServerId).toBe(server.id)
    expect(pending?.serverUrl).toBe(new URL(SERVER).toString())
  })

  it('reuses the stored client when the redirect uri matches', async () => {
    const env = build()
    const server = await seedGrant(env)
    await beginFor(env, server)
    expect(env.fetcher.callsTo(`${AUTH}/register`)).toHaveLength(0)
  })

  it('is unsupported when the server needs no sign-in', async () => {
    const env = build()
    env.fetcher.on(SERVER, () => json({ result: {} }))
    const server = await addCloudServer(env)
    const result = await beginFor(env, server)
    expect(result).toEqual({
      outcome: EMcpOauthBeginOutcome.Unsupported,
      reason: 'server does not require sign-in',
    })
  })

  it('is unsupported without a registration endpoint', async () => {
    const env = build()
    installIssuer(env.fetcher, { registration: false })
    const server = await addCloudServer(env)
    const result = await beginFor(env, server)
    expect(result.outcome).toBe(EMcpOauthBeginOutcome.Unsupported)
  })

  it('is unsupported for a stdio cloud server', async () => {
    const env = build()
    const cipher = env.cipher
    const server = await addCloudServer(env)
    const stored = env.store.servers.get(server.id)
    if (stored === undefined) throw new Error('no server')
    stored.sealedSpec = cipher.encrypt(
      JSON.stringify({ name: server.name, transport: { kind: 'stdio', command: 'npx' } }),
    )
    const result = await beginFor(env, server)
    expect(result.outcome).toBe(EMcpOauthBeginOutcome.Unsupported)
    expect(env.fetcher.calls).toHaveLength(0)
  })

  it('is unsupported for a cloud server with its own authorization header', async () => {
    const env = build()
    const server = await addCloudServer(env, {
      headers: { Authorization: 'Bearer own-token' },
    })
    const result = await beginFor(env, server)
    expect(result.outcome).toBe(EMcpOauthBeginOutcome.Unsupported)
    expect(env.fetcher.calls).toHaveLength(0)
  })

  it('is not found for a server another user owns', async () => {
    const env = build()
    const server = await addCloudServer(env, { userId: 'user-b' })
    await expect(beginFor(env, server)).rejects.toThrow('mcp server not found')
  })

  it('reaches a project server through the project owner', async () => {
    const env = build()
    const server = await addCloudServer(env, { projectId: 'proj-1', projectOwner: 'user-a' })
    const result = await beginFor(env, server)
    expect(result.outcome).toBe(EMcpOauthBeginOutcome.Redirect)
  })

  it('rejects a discovered endpoint that points at a private host', async () => {
    const env = build()
    env.fetcher.on(`${AUTH}/.well-known/oauth-authorization-server`, () =>
      json({
        authorization_endpoint: `${AUTH}/authorize`,
        token_endpoint: 'https://10.0.0.5/token',
        registration_endpoint: `${AUTH}/register`,
      }),
    )
    const server = await addCloudServer(env)
    const result = await beginFor(env, server)
    expect(result.outcome).toBe(EMcpOauthBeginOutcome.Unsupported)
    expect(env.fetcher.callsTo(`${AUTH}/register`)).toHaveLength(0)
  })
})
