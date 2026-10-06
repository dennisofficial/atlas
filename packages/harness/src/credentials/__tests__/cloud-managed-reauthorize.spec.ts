import { describe, expect, it } from 'bun:test'

import {
  authorityOf,
  EAccountOrigin,
  EAuthKind,
  EAuthProvider,
} from '@dltech/atlas-core'

import { seed, session, setup } from './cloud-managed-fixture'
import { settledSecret } from './cloud-managed-fixture'

describe('reauthorizing an owned grant', () => {
  const owned = async () => {
    const env = setup()
    const account = await env.addOauth()
    await env.port.read({ provider: EAuthProvider.Anthropic })
    await env.port.handoffAll(session)

    return { ...env, account }
  }

  it('returns a signed-out replacement unowned', async () => {
    const env = setup({ signedIn: false })
    const secret = await env.port.prepareReplacement({ accountId: 'acc_x' as never, secret: seed() })

    expect(authorityOf(secret)).toBeUndefined()
  })

  it('keeps the same connection with a new authorization id chained to its predecessor', async () => {
    const { port, account } = await owned()

    const replacement = await port.prepareReplacement({ accountId: account.id, secret: seed({ access: 'fake-new', refresh: 'fake-new-refresh' }) })

    const authority = authorityOf(replacement)
    expect(authority?.connectionId).toBe('oauth_1')
    expect(authority?.previousAuthorizationId).toBe('oauth_1')
    expect(authority?.authorizationId).toBeDefined()
  })

  it('uses a new lineage for a fresh login when the pending connection never reached the API', async () => {
    const env = setup()
    const account = await env.addOauth()
    env.api.down = true
    await env.port.handoffAll(session).catch(() => undefined)
    env.api.down = false

    const replacement = await env.accounts.withAccountLock({
      accountId: account.id,
      run: () => env.port.prepareReplacement({ accountId: account.id, secret: seed({ access: 'fake-new' }) }),
    })

    expect(authorityOf(replacement)).toBeUndefined()
  })

  it('lets a fresh native login recover from a deleted cloud connection', async () => {
    const { api, port, account } = await owned()
    api.connections.delete('oauth_1')
    const replacement = await port.prepareReplacement({ accountId: account.id, secret: seed({ access: 'fresh', refresh: 'fresh-grant' }) })
    expect(authorityOf(replacement)).toBeUndefined()
  })

  it('lets a fresh native login move to another authority instead of getting stuck', async () => {
    const env = await owned()
    env.state.session = { ...session, url: 'https://other.test' }
    const replacement = await env.port.prepareReplacement({ accountId: env.account.id, secret: seed({ access: 'fresh', refresh: 'fresh-grant' }) })
    expect(authorityOf(replacement)).toBeUndefined()
  })

  it('uses the server authorization head when another session reauthorized first', async () => {
    const { api, port, account } = await owned()
    const connection = api.connections.get('oauth_1')
    if (connection === undefined) throw new Error('connection missing')
    connection.authorizationId = 'another-native-login'
    const replacement = await port.prepareReplacement({ accountId: account.id, secret: seed({ access: 'fresh', refresh: 'fresh-grant' }) })
    expect(authorityOf(replacement)?.previousAuthorizationId).toBe('another-native-login')
  })

  it('uploads the replacement with reauthorize on the same connection and clears the seed', async () => {
    const { api, accounts, port, account } = await owned()
    const replacement = await port.prepareReplacement({ accountId: account.id, secret: seed({ access: 'fake-new', refresh: 'fake-new-refresh' }) })
    await accounts.replaceSecret({ accountId: account.id, secret: replacement })

    await port.read({ provider: EAuthProvider.Anthropic })
    await port.handoffAll(session)

    const secret = await settledSecret(accounts, account.id)
    expect(api.calls).toContain('PUT /v1/oauth-connections/oauth_1/reauthorize')
    expect(api.connections.size).toBe(1)
    expect(api.connections.get('oauth_1')?.refresh).toBe('fake-new-refresh')
    expect(secret.tokens.refreshToken).toBe('')
    expect(secret.authority?.previousAuthorizationId).toBeUndefined()
    expect(secret.authority?.authorizationId).toBe(authorityOf(replacement)?.authorizationId)
  })
})
