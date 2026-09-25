import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  EAccountOrigin,
  EAccountStatus,
  EAuthKind,
  EAuthProvider,
  type ClockPort,
} from '@dltech/atlas-core'

import { memoryAccountStore } from '../../credentials/account-store'
import { BrokeredCredentialPort } from '../../credentials/brokered-credential-port'
import { CredentialError, ECredentialFailure } from '../../credentials/credential-error'
import { AccountStoreProxy } from '../account-store-proxy'
import { CloudError } from '../cloud-transport'
import { CloudSessionStore } from '../cloud-session'

let nowIso = '2026-01-01T00:00:00.000Z'
const clock: ClockPort = { now: () => nowIso }

let directory: string
let sessions: CloudSessionStore
let fetchCalls: { url: string; body: unknown }[]
let answer: (url?: string) => Response
const realFetch = globalThis.fetch

const brokering = () =>
  new Response(
    JSON.stringify({
      accessToken: `brokered-access-${fetchCalls.length}`,
      expiresAt: '2026-01-01T01:00:00.000Z',
    }),
    { status: 200 },
  )

const failing = (status: number) => () =>
  new Response(JSON.stringify({ message: 'the broker is having a day' }), { status })

const seedOauthAccount = async (accounts: ReturnType<typeof memoryAccountStore>) => {
  await accounts.add({
    provider: EAuthProvider.Anthropic,
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
  await accounts.setActive({ provider: EAuthProvider.Anthropic, accountId: added!.id })
  return added!.id
}

const signedInPort = async () => {
  const accounts = memoryAccountStore({ clock })
  await seedOauthAccount(accounts)
  return new BrokeredCredentialPort({ accounts, sessions, clock })
}

beforeEach(() => {
  nowIso = '2026-01-01T00:00:00.000Z'
  directory = mkdtempSync(join(tmpdir(), 'atlas-brokered-'))
  sessions = new CloudSessionStore({
    file: join(directory, 'cloud.json'),
    keyFile: join(directory, 'key'),
  })
  sessions.write({ url: 'https://cloud.test', token: 'sess', email: null })

  fetchCalls = []
  answer = brokering
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({
      url: String(url),
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    })
    return answer()
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
  rmSync(directory, { recursive: true, force: true })
})

describe('BrokeredCredentialPort', () => {
  it('reads the access token from the broker for the active account', async () => {
    const port = await signedInPort()

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
    const port = await signedInPort()

    const first = await port.read()
    await port.discard(first)
    await port.read()

    expect(fetchCalls).toHaveLength(2)
    expect(fetchCalls[1]!.body).toEqual({ rejectedAccessToken: 'brokered-access-1' })
  })

  it('clears the rejection once the broker answers with a different token', async () => {
    const port = await signedInPort()

    const first = await port.read()
    await port.discard(first)
    await port.read()

    nowIso = '2026-01-01T00:56:00.000Z'
    await port.read()

    expect(fetchCalls[2]!.body).toEqual({})
  })

  it('refuses with no-account when signed out', async () => {
    sessions.clear()
    const port = await signedInPort()

    let failure: unknown
    try {
      await port.read()
    } catch (cause) {
      failure = cause
    }
    expect(failure).toBeInstanceOf(CredentialError)
    expect((failure as CredentialError).failure).toBe(ECredentialFailure.NotFound)
  })

  it('refuses when no account exists for the provider, before calling the broker', async () => {
    const accounts = memoryAccountStore({ clock })
    const port = new BrokeredCredentialPort({ accounts, sessions, clock })

    await expect(port.read()).rejects.toBeInstanceOf(CredentialError)
    expect(fetchCalls).toHaveLength(0)
  })
})

describe('BrokeredCredentialPort holding what it minted', () => {
  it('answers later reads from the held token instead of minting again', async () => {
    const port = await signedInPort()

    const first = await port.read()
    const second = await port.read()

    expect(fetchCalls).toHaveLength(1)
    expect(second).toEqual(first)
  })

  it('mints once when reads race', async () => {
    const port = await signedInPort()

    const [first, second] = await Promise.all([port.read(), port.read()])

    expect(fetchCalls).toHaveLength(1)
    expect(second).toEqual(first)
  })

  it('mints again once the held token nears expiry', async () => {
    const port = await signedInPort()
    await port.read()

    nowIso = '2026-01-01T00:56:00.000Z'
    const later = await port.read()

    expect(fetchCalls).toHaveLength(2)
    expect(later).toMatchObject({ accessToken: 'brokered-access-2' })
  })

  it('serves the held token while the broker is unreachable and it has not expired', async () => {
    const port = await signedInPort()
    await port.read()

    answer = failing(503)
    nowIso = '2026-01-01T00:56:00.000Z'
    const later = await port.read()

    expect(fetchCalls).toHaveLength(2)
    expect(later).toMatchObject({ accessToken: 'brokered-access-1' })
  })

  it('refuses once the held token has expired and the broker is still unreachable', async () => {
    const port = await signedInPort()
    await port.read()

    answer = failing(503)
    nowIso = '2026-01-01T01:00:01.000Z'

    await expect(port.read()).rejects.toBeInstanceOf(CloudError)
  })

  it('refuses a rejected session rather than serving the held token', async () => {
    const port = await signedInPort()
    await port.read()

    answer = failing(401)
    nowIso = '2026-01-01T00:56:00.000Z'

    await expect(port.read()).rejects.toBeInstanceOf(CloudError)
  })

  it('forgets what it held when the signed-in session changes', async () => {
    const port = await signedInPort()
    await port.read()

    sessions.write({ url: 'https://cloud.test', token: 'sess_b', email: null })
    await port.read()

    expect(fetchCalls).toHaveLength(2)
  })

  it('drops the held token when the credential is discarded', async () => {
    const port = await signedInPort()

    const first = await port.read()
    await port.discard(first)
    const second = await port.read()

    expect(fetchCalls).toHaveLength(2)
    expect(second).toMatchObject({ accessToken: 'brokered-access-2' })
  })
})

describe('BrokeredCredentialPort reading account metadata through an outage', () => {
  const remoteAccountBody = {
    id: 'acc_cloud_1',
    provider: EAuthProvider.Anthropic,
    kind: EAuthKind.Oauth,
    origin: 'login',
    label: 'cloud account',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }

  const remoteStoredBody = {
    ...remoteAccountBody,
    secret: {
      kind: 'oauth',
      tokens: {
        accessToken: 'stored-access',
        refreshToken: 'stored-refresh',
        expiresAt: '2026-01-01T00:30:00.000Z',
        accountId: 'user_1',
      },
    },
  }

  const answerFor = (url?: string): Response => {
    if (url === undefined) return brokering()
    if (url.endsWith('/access-token')) return brokering()
    if (url.includes('/v1/accounts/active/'))
      return new Response(JSON.stringify({ accountId: 'acc_cloud_1' }), { status: 200 })
    if (url.endsWith('/v1/accounts'))
      return new Response(JSON.stringify([remoteAccountBody]), { status: 200 })
    return new Response(JSON.stringify(remoteStoredBody), { status: 200 })
  }

  const proxiedPort = () => {
    const local = memoryAccountStore({ clock })
    const proxy = new AccountStoreProxy({ local, sessions, clock })
    return new BrokeredCredentialPort({ accounts: proxy, sessions, clock })
  }

  const outageAnswering = () => {
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      fetchCalls.push({
        url: String(url),
        body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      })
      return answer(String(url))
    }) as typeof fetch
  }

  it('falls back to the last-known account metadata when the cloud 504s mid-session', async () => {
    answer = answerFor
    outageAnswering()
    const port = proxiedPort()

    const first = await port.read()
    expect(first).toMatchObject({ kind: EAuthKind.Oauth, accountId: 'acc_cloud_1' })
    if (first.kind !== EAuthKind.Oauth) throw new Error('expected an oauth credential')
    expect(first.accessToken).toMatch(/^brokered-access-/)

    answer = failing(504)
    nowIso = '2026-01-01T00:56:00.000Z'
    const later = await port.read()

    expect(later).toMatchObject({ kind: EAuthKind.Oauth, accountId: 'acc_cloud_1' })
    if (later.kind !== EAuthKind.Oauth) throw new Error('expected an oauth credential')
    expect(later.accessToken).toMatch(/^brokered-access-/)
  })

  it('keeps failing when the outage predates any successful read — nothing is last-known yet', async () => {
    answer = failing(504)
    outageAnswering()
    const port = proxiedPort()

    await expect(port.read()).rejects.toBeInstanceOf(CloudError)
  })
})
