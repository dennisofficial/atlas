import assert from 'node:assert/strict'
import {
  EAccountOrigin, EAccountStatus, EAuthKind, EAuthProvider, SecretsPort,
  type ClockPort, type OauthTokens,
} from '@dltech/atlas-core'
import { memoryAccountStore, type AccountStore } from '../src/credentials/account-store'
import { CredentialError, ECredentialFailure } from '../src/credentials/credential-error'
import { AnthropicOauthClient } from '../src/credentials/oauth/anthropic-oauth-client'
import { CodexOauthClient } from '../src/credentials/oauth/codex-oauth-client'
import { RefreshingCredentialPort } from '../src/credentials/refreshing-credential-port'
import { OAuthCallbackServer } from '../src/mcp/oauth/callback-server'
import { McpOAuthFlow } from '../src/mcp/oauth/flow'
import { McpOAuthStore } from '../src/mcp/oauth/token-store'

enum EProtocol { Claude = 'claude', Codex = 'codex', Mcp = 'mcp' }
enum EPolicy { Rotate = 'rotate', RevokeFamily = 'revoke-family', Reusable = 'reusable' }
const startMs = Date.parse('2026-09-30T12:00:00Z')
let nowMs = startMs
const clock: ClockPort = { now: () => new Date(nowMs).toISOString() }
const latch = () => {
  let release = () => {}
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, release }
}

class SyntheticIssuer {
  accepted = 0
  refused = 0
  dropNextResponse = false
  delayRefusal: ReturnType<typeof latch> | undefined
  private arrivals = 0
  private readonly barrier = latch()
  private readonly lineages = new Map<string, { current: string; generation: number; revoked: boolean }>()
  private readonly families = new Map<string, string>()
  readonly server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: (request) => this.handle(request) })
  readonly origin = `http://127.0.0.1:${this.server.port}`

  constructor(private readonly args: { policy?: EPolicy; simultaneous?: number } = {}) {}

  issue(family: string): OauthTokens {
    const refreshToken = `fake:${family}:refresh:0`
    this.lineages.set(family, { current: refreshToken, generation: 0, revoked: false })
    this.families.set(refreshToken, family)
    return { accessToken: `fake:${family}:access:0`, refreshToken, expiresAt: new Date(startMs - 1).toISOString() }
  }

  fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    const providerEndpoint = ['https://platform.claude.com/v1/oauth/token', 'https://auth.openai.com/oauth/token'].includes(input)
    assert(providerEndpoint || input.startsWith(`${this.origin}/`), 'blocked non-simulator destination')
    const response = await globalThis.fetch(providerEndpoint ? `${this.origin}/token` : input, init)
    if (this.dropNextResponse && response.ok && input.endsWith('/token')) {
      this.dropNextResponse = false
      await response.arrayBuffer()
      throw new Error('synthetic response lost after issuer committed rotation')
    }
    return response
  }

  private async handle(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname
    if (path === '/.well-known/oauth-authorization-server') {
      return Response.json({ authorization_endpoint: `${this.origin}/authorize`, token_endpoint: `${this.origin}/token` })
    }
    if (path !== '/token') return new Response(null, { status: 404 })
    assert.equal(request.method, 'POST')
    const contentType = request.headers.get('content-type')
    const body: unknown = contentType === 'application/json'
      ? await request.json() : Object.fromEntries(new URLSearchParams(await request.text()))
    assert(body !== null && typeof body === 'object')
    const grant = body as Record<string, unknown>
    assert.equal(grant['grant_type'], 'refresh_token')
    const token = grant['refresh_token']
    assert(typeof token === 'string' && token.startsWith('fake:'), 'only synthetic tokens are allowed')
    assert(typeof grant['client_id'] === 'string')
    this.arrivals += 1
    if (this.args.simultaneous !== undefined && this.arrivals <= this.args.simultaneous) {
      if (this.arrivals === this.args.simultaneous) this.barrier.release()
      await this.barrier.promise
    }
    const family = this.families.get(token)
    const state = family === undefined ? undefined : this.lineages.get(family)
    if (state === undefined || state.revoked || token !== state.current) {
      this.refused += 1
      if (state !== undefined && this.args.policy === EPolicy.RevokeFamily) state.revoked = true
      await this.delayRefusal?.promise
      return Response.json({ error: 'invalid_grant' }, { status: 400 })
    }
    this.accepted += 1
    state.generation += 1
    if (this.args.policy !== EPolicy.Reusable) state.current = `fake:${family}:refresh:${state.generation}`
    assert(typeof family === 'string')
    this.families.set(state.current, family)
    return Response.json({ access_token: `fake:${family}:access:${state.generation}`, refresh_token: state.current, expires_in: 3600 })
  }
}

class MemorySecrets extends SecretsPort {
  private readonly values = new Map<string, string>()
  override origin(): string { return 'synthetic-memory' }
  override read(name: string): string | undefined { return this.values.get(name) }
  override write(args: { name: string; value: string }): void { this.values.set(args.name, args.value) }
  override remove(name: string): void { this.values.delete(name) }
}

type Holder = { read: () => Promise<unknown>; isRetired: () => Promise<boolean> }
async function holder(args: { protocol: EProtocol; issuer: SyntheticIssuer; tokens: OauthTokens; accounts?: AccountStore; mcpStore?: McpOAuthStore }): Promise<Holder> {
  if (args.protocol === EProtocol.Mcp) {
    const store = args.mcpStore ?? new McpOAuthStore({ secrets: new MemorySecrets() })
    const serverUrl = `${args.issuer.origin}/mcp`
    if (store.read(serverUrl) === undefined) store.write(serverUrl, { clientInfo: { clientId: 'fake-mcp-client' }, tokens: args.tokens })
    const flow = new McpOAuthFlow({ store, callbacks: new OAuthCallbackServer(), clock, fetch: args.issuer.fetch,
      openBrowser: () => { throw new Error('browser sign-in is forbidden in this spike') } })
    return { read: () => flow.currentToken({ serverUrl }), isRetired: async () => store.read(serverUrl)?.tokens === undefined }
  }
  const provider = args.protocol === EProtocol.Claude ? EAuthProvider.Anthropic : EAuthProvider.OpenAI
  const accounts = args.accounts ?? memoryAccountStore({ clock })
  if ((await accounts.list()).length === 0) {
    await accounts.add({ provider, origin: EAccountOrigin.Login, label: 'synthetic', secret: { kind: EAuthKind.Oauth, tokens: args.tokens } })
  }
  const client = args.protocol === EProtocol.Claude
    ? new AnthropicOauthClient({ clock, fetch: args.issuer.fetch })
    : new CodexOauthClient({ clock, fetch: args.issuer.fetch })
  const port = new RefreshingCredentialPort({ accounts, clients: { [provider]: client }, clock, defaultProvider: provider, sinks: [] })
  return { read: () => port.read(), isRetired: async () => (await accounts.list())[0]?.status === EAccountStatus.Expired }
}

async function usable(read: Promise<unknown>): Promise<boolean> {
  return read.then((result) => result !== undefined).catch((error: unknown) => {
    assert(error instanceof CredentialError)
    assert([ECredentialFailure.Expired, ECredentialFailure.RefreshFailed].includes(error.failure))
    return false
  })
}
async function check(args: { protocol: EProtocol; name: string; issuer?: ConstructorParameters<typeof SyntheticIssuer>[0]; run: (issuer: SyntheticIssuer) => Promise<void> }): Promise<void> {
  nowMs = startMs
  const issuer = new SyntheticIssuer(args.issuer)
  try {
    await args.run(issuer)
    console.log(`PASS ${args.protocol}: ${args.name} (accepted=${issuer.accepted}, refused=${issuer.refused})`)
  } finally {
    await issuer.server.stop(true)
  }
}

for (const protocol of Object.values(EProtocol)) {
  await check({ protocol, name: 'sequential detached copies lose renewal', run: async (issuer) => {
    const tokens = issuer.issue('shared')
    const local = await holder({ protocol, issuer, tokens })
    const cloud = await holder({ protocol, issuer, tokens })
    assert(await usable(local.read()))
    assert.equal(await usable(cloud.read()), false)
    assert(await cloud.isRetired())
    assert.equal(issuer.accepted, 1)
    assert.equal(issuer.refused, 1)
  } })
  await check({ protocol, name: 'concurrent detached copies lose renewal', issuer: { simultaneous: 2 }, run: async (issuer) => {
    const tokens = issuer.issue('shared')
    const local = await holder({ protocol, issuer, tokens })
    const cloud = await holder({ protocol, issuer, tokens })
    const results = await Promise.all([usable(local.read()), usable(cloud.read())])
    assert.equal(results.filter(Boolean).length, 1)
    assert.equal(issuer.accepted, 1)
    assert.equal(issuer.refused, 1)
  } })
  await check({ protocol, name: 'replay revocation also kills winner next renewal', issuer: { policy: EPolicy.RevokeFamily }, run: async (issuer) => {
    const tokens = issuer.issue('shared')
    const local = await holder({ protocol, issuer, tokens })
    const cloud = await holder({ protocol, issuer, tokens })
    assert(await usable(local.read()))
    assert.equal(await usable(cloud.read()), false)
    nowMs += 2 * 3600_000
    assert.equal(await usable(local.read()), false)
    assert.equal(issuer.refused, 2)
  } })
  await check({ protocol, name: 'independent local plus two sandbox grants survive two cycles', issuer: { simultaneous: 3 }, run: async (issuer) => {
    const holders = await Promise.all(['local', 'cloud-a', 'cloud-b'].map((family) => holder({ protocol, issuer, tokens: issuer.issue(family) })))
    assert((await Promise.all(holders.map((owner) => usable(owner.read())))).every(Boolean))
    nowMs += 2 * 3600_000
    assert((await Promise.all(holders.map((owner) => usable(owner.read())))).every(Boolean))
    assert.equal(issuer.accepted, 6)
    assert.equal(issuer.refused, 0)
  } })
  await check({ protocol, name: 'explicit reusable issuer permits copied grants', issuer: { policy: EPolicy.Reusable, simultaneous: 2 }, run: async (issuer) => {
    const tokens = issuer.issue('shared')
    const owners = await Promise.all([holder({ protocol, issuer, tokens }), holder({ protocol, issuer, tokens })])
    assert((await Promise.all(owners.map((owner) => usable(owner.read())))).every(Boolean))
    assert.equal(issuer.accepted, 2)
    assert.equal(issuer.refused, 0)
  } })
  await check({ protocol, name: 'lost rotation response cannot be recovered from stale copy', run: async (issuer) => {
    const owner = await holder({ protocol, issuer, tokens: issuer.issue('shared') })
    issuer.dropNextResponse = true
    assert.equal(await usable(owner.read()), false)
    assert.equal(await usable(owner.read()), false)
    assert(await owner.isRetired())
    assert.equal(issuer.accepted, 1)
    assert.equal(issuer.refused, protocol === EProtocol.Mcp ? 0 : 1)
  } })
  await check({ protocol, name: protocol === EProtocol.Mcp ? 'one MCP flow still races simultaneous readers' : 'one Atlas port coalesces simultaneous readers',
    issuer: protocol === EProtocol.Mcp ? { simultaneous: 2 } : {}, run: async (issuer) => {
    const owner = await holder({ protocol, issuer, tokens: issuer.issue('shared') })
    const results = await Promise.all([usable(owner.read()), usable(owner.read())])
    assert.equal(results.filter(Boolean).length, protocol === EProtocol.Mcp ? 1 : 2)
    assert.equal(issuer.accepted, 1)
    assert.equal(issuer.refused, protocol === EProtocol.Mcp ? 1 : 0)
  } })
  await check({ protocol, name: protocol === EProtocol.Mcp ? 'shared-store loser clears winner tokens' : 'shared-vault loser recovers after winner persists', issuer: { simultaneous: 2 }, run: async (issuer) => {
    const accounts = memoryAccountStore({ clock })
    const mcpStore = new McpOAuthStore({ secrets: new MemorySecrets() })
    const tokens = issuer.issue('shared')
    const first = await holder({ protocol, issuer, tokens, accounts, mcpStore })
    const second = await holder({ protocol, issuer, tokens, accounts, mcpStore })
    issuer.delayRefusal = latch()
    const work = [first.read(), second.read()]
    await Promise.any(work)
    issuer.delayRefusal.release()
    const results = await Promise.all(work.map(usable))
    assert.equal(results.filter(Boolean).length, protocol === EProtocol.Mcp ? 1 : 2)
    if (protocol === EProtocol.Mcp) assert(await first.isRetired())
    assert.equal(issuer.accepted, 1)
    assert.equal(issuer.refused, 1)
  } })
  await check({ protocol, name: 'serialized reread of shared current state supports three holders', issuer: { policy: EPolicy.RevokeFamily }, run: async (issuer) => {
    const accounts = memoryAccountStore({ clock })
    const mcpStore = new McpOAuthStore({ secrets: new MemorySecrets() })
    const tokens = issuer.issue('shared')
    const owners: Holder[] = []
    for (let index = 0; index < 3; index += 1) owners.push(await holder({ protocol, issuer, tokens, accounts, mcpStore }))
    let queue: Promise<unknown> = Promise.resolve()
    const coordinatedRead = (owner: Holder) => {
      const result = queue.then(() => owner.read())
      queue = result.catch(() => undefined)
      return usable(result)
    }
    assert((await Promise.all(owners.map(coordinatedRead))).every(Boolean))
    nowMs += 2 * 3600_000
    assert((await Promise.all(owners.map(coordinatedRead))).every(Boolean))
    assert.equal(issuer.accepted, 2)
    assert.equal(issuer.refused, 0)
  } })
}
console.log('PASS 27 synthetic scenarios; no live provider or Atlas API requests; no credential files read or written')
