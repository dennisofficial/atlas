import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  EAccountOrigin,
  EAccountStatus,
  EAuthKind,
  EAuthProvider,
  toAccountId,
  type ClockPort,
} from '@dltech/atlas-core'

import { memoryAccountStore } from '../../credentials/account-store'
import { BrokeredCredentialPort } from '../../credentials/brokered-credential-port'
import { CredentialError, ECredentialFailure } from '../../credentials/credential-error'
import { CloudSessionStore } from '../cloud-session'

const clock: ClockPort = { now: () => '2026-01-01T00:00:00.000Z' }

let directory: string
let sessions: CloudSessionStore
let fetchCalls: { url: string; body: unknown }[]
const realFetch = globalThis.fetch

const seedOauthAccount = async (
  accounts: ReturnType<typeof memoryAccountStore>,
  args: { id: string; provider: EAuthProvider },
) => {
  await accounts.add({
    provider: args.provider,
    label: 'cloud account',
    origin: EAccountOrigin.Login,
    secret: {
      kind: EAuthKind.Oauth,
      tokens: {
        accessToken: 'stored-access',
        refreshToken: 'stored-refresh',
        expiresAt: '2026-01-01T00:30:00.000Z',
      },
    },
  })
  const added = (await accounts.list())[0]
  await accounts.setStatus({ accountId: added!.id, status: EAccountStatus.Active })
  await accounts.setActive({ provider: args.provider, accountId: added!.id })
  return added!.id
}

describe('BrokeredCredentialPort', () => {
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'atlas-brokered-'))
    sessions = new CloudSessionStore({
      file: join(directory, 'cloud.json'),
      keyFile: join(directory, 'key'),
    })
    sessions.write({ url: 'https://cloud.test', token: 'sess', email: null })

    fetchCalls = []
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      fetchCalls.push({
        url: String(url),
        body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      })
      return new Response(
        JSON.stringify({
          accessToken: `brokered-access-${fetchCalls.length}`,
          expiresAt: '2026-01-01T01:00:00.000Z',
        }),
        { status: 200 },
      )
    }) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = realFetch
    rmSync(directory, { recursive: true, force: true })
  })

  it('reads the access token from the broker for the active account', async () => {
    const accounts = memoryAccountStore({ clock })
    await seedOauthAccount(accounts, { id: 'acc_1', provider: EAuthProvider.Anthropic })
    const port = new BrokeredCredentialPort({ accounts, sessions })

    const credential = await port.read()

    expect(credential).toEqual({
      kind: EAuthKind.Oauth,
      accountId: expect.any(String),
      accessToken: 'brokered-access-1',
      expiresAt: '2026-01-01T01:00:00.000Z',
      providerAccountId: undefined,
    })
    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0]!.url).toMatch(/\/v1\/accounts\/acc_[^/]+\/access-token$/)
    expect(fetchCalls[0]!.body).toEqual({})
  })

  it('sends the discarded token so the broker refreshes past it', async () => {
    const accounts = memoryAccountStore({ clock })
    const accountId = await seedOauthAccount(accounts, {
      id: 'acc_1',
      provider: EAuthProvider.Anthropic,
    })
    const port = new BrokeredCredentialPort({ accounts, sessions })

    const first = await port.read()
    await port.discard(first)
    await port.read()

    expect(fetchCalls).toHaveLength(2)
    expect(fetchCalls[1]!.body).toEqual({ rejectedAccessToken: 'brokered-access-1' })
  })

  it('clears the rejection once the broker answers with a different token', async () => {
    const accounts = memoryAccountStore({ clock })
    await seedOauthAccount(accounts, { id: 'acc_1', provider: EAuthProvider.Anthropic })
    const port = new BrokeredCredentialPort({ accounts, sessions })

    const first = await port.read()
    await port.discard(first)
    await port.read()
    await port.read()

    expect(fetchCalls[2]!.body).toEqual({})
  })

  it('refuses with no-account when signed out', async () => {
    sessions.clear()
    const accounts = memoryAccountStore({ clock })
    await seedOauthAccount(accounts, { id: 'acc_1', provider: EAuthProvider.Anthropic })
    const port = new BrokeredCredentialPort({ accounts, sessions })

    let failure: unknown
    try {
      await port.read()
    } catch (cause) {
      failure = cause
    }
    expect(failure).toBeInstanceOf(CredentialError)
    expect((failure as CredentialError).failure).toBe(ECredentialFailure.NoAccount)
  })

  it('refuses when no account exists for the provider, before calling the broker', async () => {
    const accounts = memoryAccountStore({ clock })
    const port = new BrokeredCredentialPort({ accounts, sessions })

    await expect(port.read()).rejects.toBeInstanceOf(CredentialError)
    expect(fetchCalls).toHaveLength(0)
  })
})
