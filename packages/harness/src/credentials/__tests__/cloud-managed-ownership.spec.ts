import { describe, expect, it } from 'bun:test'

import {
  authorityOf,
  EAccountOrigin,
  EAuthKind,
  EAuthProvider,
} from '@dltech/atlas-core'

import { CredentialError } from '../credential-error'
import { seed, session, setup, settledSecret } from './cloud-managed-fixture'

describe('cloud-managed credential ownership', () => {

  it('never delegates a cloud-owned grant to the local refresher after sign-out or outage', async () => {
    const { api, accounts, port, state, localReads, addOauth } = setup()
    const account = await addOauth()
    await port.read({ provider: EAuthProvider.Anthropic })
    await port.handoffAll(session)

    state.session = null
    const cached = await port.read({ provider: EAuthProvider.Anthropic })
    expect(cached.kind).toBe(EAuthKind.Oauth)

    const stored = await settledSecret(accounts, account.id)
    await accounts.replaceSecret({
      accountId: account.id,
      secret: { ...stored, tokens: { ...stored.tokens, expiresAt: '2026-10-05T11:00:00.000Z' } },
    })
    await expect(port.read({ provider: EAuthProvider.Anthropic })).rejects.toThrow('Sign back in to Atlas Cloud')

    state.session = session
    api.down = true
    await expect(port.read({ provider: EAuthProvider.Anthropic })).rejects.toBeInstanceOf(CredentialError)
    expect(localReads).toEqual([])
  })

  it('serves cached access through an outage until it expires', async () => {
    const { api, port, addOauth } = setup()
    await addOauth()
    await port.read({ provider: EAuthProvider.Anthropic })
    await port.handoffAll(session)
    api.down = true

    const during = await port.read({ provider: EAuthProvider.Anthropic })

    expect(during.kind === EAuthKind.Oauth && during.accessToken).toBe('fake-access')
  })

  it('leaves api keys and signed-out local grants with the local port', async () => {
    const { accounts, port, state, localReads, api } = setup({ signedIn: false })
    const key = await accounts.add({
      provider: EAuthProvider.OpenRouter,
      label: 'key',
      secret: { kind: EAuthKind.ApiKey, apiKey: 'fake-key' },
      origin: EAccountOrigin.Login,
    })
    const local = await accounts.add({
      provider: EAuthProvider.Anthropic,
      label: 'local',
      secret: seed(),
      origin: EAccountOrigin.Login,
    })

    state.session = session
    await port.read({ provider: EAuthProvider.OpenRouter })
    state.session = null
    await port.read({ provider: EAuthProvider.Anthropic })

    expect(localReads).toEqual([key.id, local.id])
    expect(api.calls).toEqual([])
    expect(authorityOf((await settledSecret(accounts, local.id)))).toBeUndefined()
  })

  it('refuses a grant imported from a CLI with a reauthorization remedy and never uploads it', async () => {
    const { api, port, addOauth } = setup()
    await addOauth(seed(), { importedFrom: 'claude-code' })

    await expect(port.read({ provider: EAuthProvider.Anthropic })).rejects.toThrow('Sign in again with /auth')
    expect(api.calls).toEqual([])
  })

  it('refuses a different signed-in API instead of migrating the grant', async () => {
    const { api, port, state, addOauth } = setup()
    await addOauth()
    await port.read({ provider: EAuthProvider.Anthropic })
    await port.handoffAll(session)
    state.session = { ...session, url: 'https://other.test' }
    const before = api.calls.length

    await expect(port.read({ provider: EAuthProvider.Anthropic })).rejects.toThrow('different Atlas Cloud API')
    expect(api.calls.length).toBe(before)
  })

  it('returns the current token for a delayed rejection of an already-rotated one', async () => {
    const { api, port, addOauth } = setup()
    await addOauth()
    const first = await port.read({ provider: EAuthProvider.Anthropic })
    await port.handoffAll(session)
    const held = api.connections.get('oauth_1')!
    held.access = 'fake-successor'
    held.generation = 1

    await port.discard(first)
    const next = await port.read({ provider: EAuthProvider.Anthropic })

    expect(next.kind === EAuthKind.Oauth && next.accessToken).toBe('fake-successor')
  })

  it('transfers a new native grant while signed in on its next read', async () => {
    const { api, accounts, port, addOauth } = setup()
    await addOauth()
    await port.read({ provider: EAuthProvider.Anthropic })
    await port.handoffAll(session)
    const second = await accounts.add({
      provider: EAuthProvider.OpenAI,
      label: 'codex',
      secret: seed({ access: 'fake-codex' }),
      origin: EAccountOrigin.Login,
    })

    await port.read({ provider: EAuthProvider.OpenAI, accountId: second.id })
    await port.handoffAll(session)

    expect(api.connections.size).toBe(2)
  })

  it('handoffAll transfers native grants without an unrelated CLI import blocking them', async () => {
    const { api, accounts, port, addOauth } = setup()
    const one = await addOauth()
    await addOauth(seed({ access: 'fake-two' }), { importedFrom: 'codex' })

    await port.handoffAll(session)

    expect(authorityOf((await settledSecret(accounts, one.id)))?.url).toBe(session.url)
    expect(api.connections.size).toBe(1)
  })
})

describe('two local accounts sharing one connection id', () => {
  it('answers each read with its own account, never the other alias', async () => {
    const { accounts, port, addOauth } = setup()
    const first = await addOauth()
    await port.read({ provider: EAuthProvider.Anthropic, accountId: first.id })
    await port.handoffAll(session)
    const stored = await settledSecret(accounts, first.id)
    const alias = await accounts.add({
      provider: EAuthProvider.Anthropic,
      label: 'alias',
      secret: { ...stored, tokens: { ...stored.tokens, expiresAt: '2026-10-05T12:01:00.000Z' } },
      origin: EAccountOrigin.Login,
    })

    const [one, two] = await Promise.all([
      port.read({ provider: EAuthProvider.Anthropic, accountId: first.id }),
      port.read({ provider: EAuthProvider.Anthropic, accountId: alias.id }),
    ])

    expect(one.accountId).toBe(first.id)
    expect(two.accountId).toBe(alias.id)
  })
})
