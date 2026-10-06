import { describe, expect, it } from 'bun:test'

import {
  authorityOf,
  EAccountOrigin,
  EAuthKind,
  EAuthProvider,
} from '@dltech/atlas-core'

import { CloudManagedCredentialPort } from '../cloud-managed-credential-port'
import { CredentialError } from '../credential-error'
import { session, NOW, seed, setup, settledSecret } from './cloud-managed-fixture'

describe('cloud-managed credential handoff', () => {
  it('hands an unowned grant off on first read, persisting authority first and stripping the seed after', async () => {
    const { api, accounts, port, addOauth } = setup()
    const account = await addOauth()

    const credential = await port.read({ provider: EAuthProvider.Anthropic })

    expect(credential.kind).toBe(EAuthKind.Oauth)
    await port.handoffAll(session)
    const secret = await settledSecret(accounts, account.id)
    expect(secret.tokens.refreshToken).toBe('')
    expect(secret.authority?.connectionId).toBe('oauth_1')
    expect(api.connections.get('oauth_1')?.refresh).toBe('fake-refresh')
  })

  it('persists the authority marker before the upload goes out', async () => {
    const { api, accounts, port, addOauth } = setup()
    const account = await addOauth()
    let markerDuringUpload: unknown
    const original = api.fetchFn
    api.fetchFn = Object.assign(
      async (input: string | URL | Request, init?: RequestInit) => {
        markerDuringUpload = authorityOf((await accounts.read(account.id))!.secret)
        return original(input, init)
      },
      { preconnect: () => undefined },
    )

    await port.read({ provider: EAuthProvider.Anthropic })
    await port.handoffAll(session)

    expect(markerDuringUpload).toEqual({ url: session.url, connectionId: 'oauth_1' })
  })

  it('keeps the pending seed and marker across an outage, then retries the same idempotent upload', async () => {
    const { api, accounts, port, addOauth } = setup()
    const account = await addOauth(seed({ expiresAt: '2026-10-05T11:00:00.000Z' }))
    api.down = true

    await expect(port.read({ provider: EAuthProvider.Anthropic })).rejects.toBeInstanceOf(CredentialError)
    const pending = await settledSecret(accounts, account.id)
    expect(pending.tokens.refreshToken).toBe('fake-refresh')
    expect(pending.authority?.connectionId).toBe('oauth_1')

    api.down = false
    await port.handoffAll(session)
    await port.read({ provider: EAuthProvider.Anthropic })

    expect((await settledSecret(accounts, account.id)).tokens.refreshToken).toBe('')
    expect(api.connections.size).toBe(1)
  })

  it('keeps serving valid access while a pending handoff cannot reach the API, without local refresh', async () => {
    const { api, accounts, port, localReads, addOauth } = setup()
    const account = await addOauth()
    api.down = true
    const credential = await port.read({ provider: EAuthProvider.Anthropic })
    expect(credential).toMatchObject({ accessToken: 'fake-access' })
    expect(localReads).toEqual([])
    expect((await settledSecret(accounts, account.id)).authority?.connectionId).toBe('oauth_1')
    expect((await settledSecret(accounts, account.id)).tokens.refreshToken).toBe('fake-refresh')
    await port.discard(credential)
    await expect(port.read({ provider: EAuthProvider.Anthropic })).rejects.toBeInstanceOf(CredentialError)
  })

  it('returns cached access without waiting for a blackholed pending upload', async () => {
    const { api, accounts, port, addOauth } = setup()
    const account = await addOauth()
    let release: ((response: Response) => void) | undefined
    const gate = new Promise<Response>((resolve) => { release = resolve })
    api.fetchFn = Object.assign(async () => gate, { preconnect: () => undefined })
    const credential = await port.read({ provider: EAuthProvider.Anthropic })
    expect(credential).toMatchObject({ accessToken: 'fake-access' })
    expect((await settledSecret(accounts, account.id)).authority?.connectionId).toBe('oauth_1')
    release?.(Response.json({ accessToken: 'fake-access', expiresAt: '2026-10-05T13:00:00.000Z', generation: 0, authorizationId: 'oauth_1' }))
    await port.handoffAll(session)
    expect((await settledSecret(accounts, account.id)).tokens.refreshToken).toBe('')
  })

  it('refuses a legacy access-only copy without inventing a renewable cloud connection', async () => {
    const { api, accounts, port, addOauth } = setup()
    const account = await addOauth(seed({ refresh: '' }))
    await expect(port.read({ provider: EAuthProvider.Anthropic })).rejects.toThrow('no renewable grant')
    expect(api.calls).toEqual([])
    expect(authorityOf((await accounts.read(account.id))!.secret)).toBeUndefined()
  })

  it('survives a restart mid-handoff: a fresh port reuses the persisted connection id', async () => {
    const first = setup()
    const account = await first.addOauth()
    first.api.down = true
    await first.port.read({ provider: EAuthProvider.Anthropic }).catch(() => undefined)

    first.api.down = false
    const restarted = new CloudManagedCredentialPort({
      accounts: first.accounts,
      local: { read: async () => Promise.reject(new Error('local used')), discard: async () => undefined },
      clock: { now: () => NOW },
      session: () => session,
      clients: () => first.api.client(),
      newConnectionId: () => 'oauth_other',
    })
    await restarted.handoffAll(session)
    await restarted.read({ provider: EAuthProvider.Anthropic })

    expect([...first.api.connections.keys()]).toEqual(['oauth_1'])
    expect((await settledSecret(first.accounts, account.id)).authority?.connectionId).toBe('oauth_1')
  })

  it('transfers once when two ports share the store and read concurrently', async () => {
    const one = setup()
    await one.addOauth()
    const other = new CloudManagedCredentialPort({
      accounts: one.accounts,
      local: { read: async () => Promise.reject(new Error('local used')), discard: async () => undefined },
      clock: { now: () => NOW },
      session: () => session,
      clients: () => one.api.client(),
    })

    await Promise.all([
      one.port.read({ provider: EAuthProvider.Anthropic }),
      other.read({ provider: EAuthProvider.Anthropic }),
    ])

    await one.port.handoffAll(session)
    expect(one.api.connections.size).toBe(1)
  })
})
