import { beforeEach, describe, expect, it } from 'bun:test'
import { EReturnResult } from '@dltech/atlas-core'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { GithubConfig, GithubDeviceClient, GithubService, type FetchFn } from '@dltech/atlas-github'
import { connectionRows, ensureUsers } from '../../../../../test/github-seed'
import { EnvService } from '../../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../../_lib/crypto/secret-cipher.service'
import { BrowserReturnService } from '../../../../agent'
import { GithubRedirectService } from '../github-redirect.service'

const testDb = useTestDatabase()
const scopes = 'repo read:org admin:repo_hook admin:ssh_signing_key workflow'
const redirectUri = 'https://api.byatlas.io/v1/github/oauth/callback'
const cipher = new SecretCipherService(
  new EnvService({
    SECRETS_ENCRYPTION_KEY: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
  }),
)
let requests: string[]
let grantedScopes: string
let failure: string | undefined
let returns: BrowserReturnService
let service: GithubRedirectService
let beforeExchange: (() => Promise<void>) | undefined

beforeEach(async () => {
  await ensureUsers('user-a', 'user-b')
  requests = []
  grantedScopes = scopes
  failure = undefined
  beforeExchange = undefined
  const fetchFn: FetchFn = async (url) => {
    requests.push(url)
    if (!url.endsWith('/user')) {
      const gate = beforeExchange
      beforeExchange = undefined
      await gate?.()
    }
    const body = url.endsWith('/user')
      ? { login: 'octocat' }
      : failure === undefined
        ? { access_token: 'token', scope: grantedScopes }
        : { error: 'bad_verification_code', error_description: failure }
    return { ok: true, status: 200, text: async () => JSON.stringify(body) }
  }
  const client = new GithubDeviceClient({ fetchFn })
  const config = new GithubConfig({
    clientId: 'client',
    clientSecret: 'secret',
    publicApiUrl: 'https://api.byatlas.io',
  })
  returns = new BrowserReturnService({
    db: testDb().db,
    cipher,
    publicUrl: 'https://api.byatlas.io',
    webOrigin: 'https://byatlas.io',
  })
  service = new GithubRedirectService(
    new GithubService(cipher, config, client),
    client,
    config,
    returns,
  )
})

const begin = async () => {
  const result = await service.begin({ userId: 'user-a' })
  const state = result.url.split('/').at(-1) ?? ''
  return { state, result }
}
const callback = (state: string) =>
  service.callback({ state, code: 'code', cookieHeader: undefined })

describe('GitHub browser redirect', () => {
  it('stores the authenticated user, requests scopes and uses the registered callback', async () => {
    const { state } = await begin()
    const started = await returns.start({ state, surface: 'tui', port: 53210 })
    if (started.kind !== 'redirect') throw new Error('expected provider redirect')
    const provider = new URL(started.location)
    expect(provider.origin + provider.pathname).toBe('https://github.com/login/oauth/authorize')
    expect(provider.searchParams.get('redirect_uri')).toBe(redirectUri)
    expect(provider.searchParams.get('scope')).toBe(scopes)
    expect(provider.searchParams.get('state')).toBe(state)
    expect(await returns.claim({ state, flow: 'mcp' })).toBeNull()
    const answer = await callback(state)
    expect(answer.kind === 'redirect' ? answer.location : '').toContain(
      'http://127.0.0.1:53210/atlas-return?atlasReturn=connected',
    )
    const rows = await connectionRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.userId).toBe('user-a')
    expect(await returns.claim({ state, flow: 'github' })).toBeNull()
    await callback(state)
    expect(requests).toHaveLength(2)
  })

  it('exchanges the code of one of two racing callbacks only', async () => {
    const { state } = await begin()

    const answers = await Promise.all([callback(state), callback(state), callback(state)])

    const locations = answers.map((answer) => (answer.kind === 'redirect' ? answer.location : ''))
    expect(locations.filter((location) => location.includes('atlasReturn=connected'))).toHaveLength(
      1,
    )
    expect(requests).toHaveLength(2)
    expect(await connectionRows()).toHaveLength(1)
  })

  it('claims the state before exchanging and keeps its target from a concurrent callback', async () => {
    const { state } = await begin()
    const started = await returns.start({ state, surface: 'tui', port: 53210 })
    if (started.kind !== 'redirect') throw new Error('expected provider redirect')
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    beforeExchange = async () => {
      entered.resolve()
      await release.promise
    }
    const winner = callback(state)
    await entered.promise
    try {
      const loser = await service.callback({
        state,
        code: 'duplicate',
        cookieHeader: started.cookie,
      })
      expect(requests.filter((url) => url.endsWith('/login/oauth/access_token'))).toHaveLength(1)
      expect(loser.kind === 'redirect' ? loser.location : '').toContain(
        'https://byatlas.io/settings/integrations?atlasReturn=failed',
      )
    } finally {
      release.resolve()
      const answer = await winner
      expect(answer.kind === 'redirect' ? answer.location : '').toContain(
        'http://127.0.0.1:53210/atlas-return?atlasReturn=connected',
      )
    }
    expect(await connectionRows()).toHaveLength(1)
  })

  it('refuses missing scopes and stores no connection', async () => {
    const { state } = await begin()
    grantedScopes = 'repo'
    const answer = await callback(state)
    expect(answer.kind === 'redirect' ? answer.location : '').toContain(
      `atlasReturn=${EReturnResult.Failed}`,
    )
    expect(answer.kind === 'redirect' ? answer.location : '').toContain('read%3Aorg')
    expect(await connectionRows()).toHaveLength(0)
    expect(requests).toHaveLength(1)
  })

  it('rejects unknown and expired states without an exchange', async () => {
    await callback('unknown')
    const { state } = await begin()
    await testDb()
      .db.orm.public.BrowserReturnPending.where({ state })
      .updateAndCount({ expiresAt: new Date(0) })
    await callback(state)
    expect(requests).toHaveLength(0)
  })

  it('returns a refusal and exchange error through the framework', async () => {
    const denied = await begin()
    const answer = await service.callback({
      state: denied.state,
      error: 'access_denied',
      errorDescription: 'Not approved',
      cookieHeader: undefined,
    })
    expect(answer.kind === 'redirect' ? answer.location : '').toContain('atlasReason=Not+approved')
    expect(requests).toHaveLength(0)
    const broken = await begin()
    failure = 'Code expired'
    const failed = await callback(broken.state)
    expect(failed.kind === 'redirect' ? failed.location : '').toContain('atlasReason=Code+expired')
  })
})
