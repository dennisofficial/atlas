import { describe, expect, it } from 'bun:test'

import { EAccountOrigin, EAuthKind, EAuthProvider, toThreadId, type AccountStorePort } from '@dltech/atlas-core'

import { memoryAccountStore } from '../../credentials/account-store'
import { prepareSandboxOauth } from '../cloud-oauth-sandbox'
import type { CloudSession } from '../cloud-session'

const session: CloudSession = { url: 'https://cloud.test', token: 'fake-operator', email: null }
const registration = { threadId: toThreadId('oauth-root'), token: 'fake-sandbox', serveUrl: 'https://sandbox.vercel.run' }
const store = () => memoryAccountStore({ clock: { now: () => '2026-10-05T12:00:00.000Z' } })
const addOauth = (accounts: AccountStorePort, authorityUrl = session.url) => accounts.add({
  provider: EAuthProvider.Anthropic,
  origin: EAccountOrigin.Login,
  label: 'native',
  secret: {
    kind: EAuthKind.Oauth,
    tokens: { accessToken: 'fake-access', refreshToken: '', expiresAt: '2026-10-05T13:00:00.000Z' },
    authority: { url: authorityUrl, connectionId: 'oauth-native' },
  },
})

const neverFetch: typeof fetch = Object.assign(
  async () => { throw new Error('unexpected API request') },
  { preconnect: () => undefined },
)

describe('sandbox OAuth capability preparation', () => {
  it('does not require the Atlas API for an API-key-only sandbox', async () => {
    const accounts = store()
    await accounts.add({ provider: EAuthProvider.OpenRouter, label: 'key', origin: EAccountOrigin.Login, secret: { kind: EAuthKind.ApiKey, apiKey: 'fake-key' } })
    await prepareSandboxOauth({ accounts, session: null, handoffOauth: undefined, registration, clientVersion: 'test', fetchFn: neverFetch })
  })

  it('requires Cloud sign-in rather than lifting nonrenewable OAuth copies', async () => {
    const accounts = store()
    await addOauth(accounts)
    await expect(prepareSandboxOauth({ accounts, session: null, handoffOauth: undefined, registration, clientVersion: 'test', fetchFn: neverFetch })).rejects.toThrow('Sign in to Atlas Cloud')
  })

  it('completes handoff then registers the sandbox before assigning only its connections', async () => {
    const accounts = store()
    await addOauth(accounts)
    await addOauth(accounts)
    const events: string[] = []
    const fetchFn: typeof fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname
      events.push(`${init?.method} ${path}`)
      if (path === '/v1/sandboxes') return Response.json({ token: registration.token, url: registration.serveUrl })
      return new Response(null, { status: 204 })
    }, { preconnect: () => undefined })
    await prepareSandboxOauth({
      accounts, session, registration, clientVersion: 'test', fetchFn,
      handoffOauth: async (held) => { expect(held).toEqual(session); events.push('handoff') },
    })
    expect(events).toEqual(['handoff', 'POST /v1/sandboxes', 'PUT /v1/oauth-connections/oauth-native/sandboxes/oauth-root'])
  })

  it('refuses a selected grant owned by another authority before registering the sandbox', async () => {
    const accounts = store()
    const foreign = await addOauth(accounts, 'https://other.test')
    await accounts.setActive({ provider: EAuthProvider.Anthropic, accountId: foreign.id })
    await expect(prepareSandboxOauth({ accounts, session, handoffOauth: async () => {}, registration, clientVersion: 'test', fetchFn: neverFetch, model: 'anthropic/claude-test' })).rejects.toThrow('/auth')
  })

  it('lets an API-key model lift past unrelated unusable OAuth records without the API', async () => {
    const accounts = store()
    const cli = await accounts.add({ provider: EAuthProvider.Anthropic, origin: EAccountOrigin.Imported, importedFrom: 'claude-code', label: 'cli', secret: { kind: EAuthKind.Oauth, tokens: { accessToken: 'fake-cli', refreshToken: 'fake-cli-refresh', expiresAt: '2026-10-05T13:00:00.000Z' } } })
    await accounts.add({ provider: EAuthProvider.OpenAI, origin: EAccountOrigin.Login, label: 'expired', secret: { kind: EAuthKind.Oauth, tokens: { accessToken: 'fake-old', refreshToken: '', expiresAt: '2026-10-05T13:00:00.000Z' } } })
    await addOauth(accounts, 'https://other.test')
    await accounts.add({ provider: EAuthProvider.OpenRouter, origin: EAccountOrigin.Login, label: 'key', secret: { kind: EAuthKind.ApiKey, apiKey: 'fake-key' } })
    await accounts.setActive({ provider: EAuthProvider.Anthropic, accountId: cli.id })
    await prepareSandboxOauth({ accounts, session: null, handoffOauth: undefined, registration, clientVersion: 'test', fetchFn: neverFetch, model: 'openrouter/some-model' })
  })

  it('refuses a selected CLI-imported OAuth login before launch', async () => {
    const accounts = store()
    const cli = await accounts.add({ provider: EAuthProvider.OpenAI, origin: EAccountOrigin.Imported, importedFrom: 'codex', label: 'cli', secret: { kind: EAuthKind.Oauth, tokens: { accessToken: 'fake-cli', refreshToken: 'fake-cli-refresh', expiresAt: '2026-10-05T13:00:00.000Z' } } })
    await accounts.setActive({ provider: EAuthProvider.OpenAI, accountId: cli.id })
    await expect(prepareSandboxOauth({ accounts, session, handoffOauth: async () => {}, registration, clientVersion: 'test', fetchFn: neverFetch, model: 'openai/gpt-test' })).rejects.toThrow('cannot be lifted')
  })

  it('hands off only eligible accounts and assigns only their connections', async () => {
    const accounts = store()
    await addOauth(accounts)
    await accounts.add({ provider: EAuthProvider.OpenAI, origin: EAccountOrigin.Imported, importedFrom: 'codex', label: 'cli', secret: { kind: EAuthKind.Oauth, tokens: { accessToken: 'fake-cli', refreshToken: 'fake-cli-refresh', expiresAt: '2026-10-05T13:00:00.000Z' } } })
    const handed: unknown[] = []
    const paths: string[] = []
    const fetchFn: typeof fetch = Object.assign(async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname
      paths.push(path)
      return path === '/v1/sandboxes' ? Response.json({ token: registration.token, url: registration.serveUrl }) : new Response(null, { status: 204 })
    }, { preconnect: () => undefined })
    await prepareSandboxOauth({ accounts, session, registration, clientVersion: 'test', fetchFn, handoffOauth: async (_held, ids) => { handed.push(ids) } })
    expect(handed).toHaveLength(1)
    expect((handed[0] as string[]).length).toBe(1)
    expect(paths).toEqual(['/v1/sandboxes', '/v1/oauth-connections/oauth-native/sandboxes/oauth-root'])
  })

  it('refuses pending handoff state rather than stripping its renewable seed into the sandbox', async () => {
    const accounts = store()
    const account = await addOauth(accounts)
    await accounts.replaceSecret({ accountId: account.id, secret: {
      kind: EAuthKind.Oauth,
      tokens: { accessToken: 'fake-access', refreshToken: 'fake-seed', expiresAt: '2026-10-05T13:00:00.000Z' },
      authority: { url: session.url, connectionId: 'oauth-native' },
    } })
    await expect(prepareSandboxOauth({ accounts, session, handoffOauth: async () => {}, registration, clientVersion: 'test', fetchFn: neverFetch })).rejects.toThrow('has not completed')
  })

  it('propagates assignment failure so lift cannot commit an unauthorized sandbox', async () => {
    const accounts = store()
    await addOauth(accounts)
    const fetchFn: typeof fetch = Object.assign(async (input: string | URL | Request) => String(input).endsWith('/v1/sandboxes')
      ? Response.json({ token: registration.token })
      : Response.json({ message: 'assignment refused' }, { status: 403 }), { preconnect: () => undefined })
    await expect(prepareSandboxOauth({ accounts, session, handoffOauth: async () => {}, registration, clientVersion: 'test', fetchFn })).rejects.toThrow('assignment refused')
  })
})
