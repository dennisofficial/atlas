import { describe, expect, it } from 'bun:test'

import {
  EAccountOrigin,
  EAccountStatus,
  EAuthKind,
  EAuthProvider,
  secretNameOf,
  EWebSearchBackend,
  toAccountId,
  type ClockPort,
} from '@dltech/atlas-core'

import { ServeAccountStore } from '../serve-account-store'
import { ServeBrokerClient } from '../serve-broker-client'
import { ServeCredentialPort } from '../serve-credential-port'
import { ServeSecretsStore } from '../serve-secrets-store'

const THREAD = 'brn_1'
const TOKEN = 'sandbox-token'

type Recorded = { url: string; method: string; body: unknown }

const brokerWith = (
  respond: (call: Recorded) => { status: number; body?: unknown },
): { broker: ServeBrokerClient; calls: Recorded[] } => {
  const calls: Recorded[] = []
  const fetchFn = (async (input: unknown, init?: RequestInit) => {
    const call: Recorded = {
      url: String(input),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    }
    calls.push(call)
    const answer = respond(call)
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
      status: answer.status,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
  return {
    broker: new ServeBrokerClient({
      url: 'http://cloud.test',
      token: TOKEN,
      threadId: THREAD,
      fetchFn,
    }),
    calls,
  }
}

const accountBody = {
  id: 'acc_1',
  provider: EAuthProvider.Anthropic,
  kind: EAuthKind.Oauth,
  origin: EAccountOrigin.Login,
  label: 'work',
  status: EAccountStatus.Active,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const clockAt = (iso: string): ClockPort => ({ now: () => iso }) as ClockPort

describe('ServeAccountStore', () => {
  it('lists accounts and resolves active pointers from one broker fetch', async () => {
    const { broker, calls } = brokerWith(() => ({
      status: 200,
      body: { accounts: [accountBody], active: [{ provider: 'anthropic', accountId: 'acc_1' }] },
    }))
    const store = new ServeAccountStore({ broker })

    const accounts = await store.list()
    const active = await store.activeFor(EAuthProvider.Anthropic)

    expect(accounts).toHaveLength(1)
    expect(active).toBe(toAccountId('acc_1'))
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(`http://cloud.test/v1/sandboxes/${THREAD}/broker/accounts`)
    expect(calls[0]?.method).toBe('GET')
  })

  it('refuses every mutation', async () => {
    const { broker } = brokerWith(() => ({ status: 200, body: { accounts: [], active: [] } }))
    const store = new ServeAccountStore({ broker })

    await expect(store.remove(toAccountId('acc_1'))).rejects.toThrow(/operator's machine/)
    await expect(
      store.setActive({ provider: EAuthProvider.Anthropic, accountId: toAccountId('acc_1') }),
    ).rejects.toThrow(/operator's machine/)
  })

  it('retries a fresh fetch after a boot-time outage instead of wedging on the rejected load', async () => {
    // A control-plane 5xx during boot outlasts cloudRequest's GET retries and makes the first
    // list() reject; the next read must reach the broker again rather than replay the cached
    // rejection, or the session never recovers. Outlast the 4-attempt retry, then recover.
    let attempts = 0
    const fetchFn = (async (input: unknown, init?: RequestInit) => {
      attempts += 1
      const ok = attempts > 4
      return new Response(
        ok ? JSON.stringify({ accounts: [accountBody], active: [] }) : 'gateway timeout',
        { status: ok ? 200 : 504, headers: { 'content-type': 'application/json' } },
      )
    }) as typeof fetch
    const broker = new ServeBrokerClient({
      url: 'http://cloud.test',
      token: TOKEN,
      threadId: THREAD,
      fetchFn,
      sleep: () => Promise.resolve(),
    })
    const store = new ServeAccountStore({ broker })

    await expect(store.list()).rejects.toThrow(/504/)
    await expect(store.list()).resolves.toHaveLength(1)
    expect(attempts).toBeGreaterThan(1)
  })
})

describe('ServeCredentialPort', () => {
  const mintedBody = {
    accountId: 'acc_1',
    kind: 'oauth',
    accessToken: 'at-live',
    expiresAt: '2026-01-01T13:00:00.000Z',
    providerAccountId: 'provider-1',
  }

  it('mints through the broker and holds the token until it nears expiry', async () => {
    const { broker, calls } = brokerWith(() => ({ status: 200, body: mintedBody }))
    const port = new ServeCredentialPort({ broker, clock: clockAt('2026-01-01T12:00:00.000Z') })

    const first = await port.read()
    const second = await port.read()

    expect(first).toMatchObject({
      kind: EAuthKind.Oauth,
      accountId: 'acc_1',
      accessToken: 'at-live',
      providerAccountId: 'provider-1',
    })
    expect(second).toEqual(first)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(`http://cloud.test/v1/sandboxes/${THREAD}/broker/access-token`)
    expect(calls[0]?.body).toEqual({ provider: 'anthropic' })
  })

  it('maps an api-key account to an api-key credential', async () => {
    const { broker } = brokerWith(() => ({
      status: 200,
      body: { accountId: 'acc_2', kind: 'api-key', accessToken: 'sk-live', expiresAt: null },
    }))
    const port = new ServeCredentialPort({ broker, clock: clockAt('2026-01-01T12:00:00.000Z') })

    const credential = await port.read({ provider: EAuthProvider.OpenAI })

    expect(credential).toEqual({ kind: EAuthKind.ApiKey, accountId: toAccountId('acc_2'), apiKey: 'sk-live' })
  })

  it('sends a discarded token back as rejected so the broker rotates', async () => {
    const { broker, calls } = brokerWith(() => ({ status: 200, body: mintedBody }))
    const port = new ServeCredentialPort({ broker, clock: clockAt('2026-01-01T12:00:00.000Z') })

    const credential = await port.read()
    await port.discard(credential)
    await port.read()

    expect(calls).toHaveLength(2)
    expect(calls[1]?.body).toEqual({ provider: 'anthropic', rejectedAccessToken: 'at-live' })
  })

  it('falls back to a held token that is still usable when the broker is unreachable', async () => {
    let mints = 0
    const { broker } = brokerWith(() => {
      mints += 1
      if (mints === 1) {
        return {
          status: 200,
          body: { ...mintedBody, expiresAt: '2026-01-01T12:04:00.000Z' },
        }
      }
      return { status: 503 }
    })
    const port = new ServeCredentialPort({ broker, clock: clockAt('2026-01-01T12:00:00.000Z') })

    await port.read()
    const fallback = await port.read()

    expect(fallback).toMatchObject({ accessToken: 'at-live' })
    expect(mints).toBe(2)
  })
})

describe('ServeSecretsStore', () => {
  it('warms exactly the keyed web-search secret names through the broker', async () => {
    const tavily = secretNameOf(EWebSearchBackend.Tavily)
    const { broker, calls } = brokerWith((call) => {
      const names = (call.body as { names: string[] }).names
      return {
        status: 200,
        body: {
          secrets: names
            .filter((name) => name === tavily)
            .map((name) => ({ name, value: 'tvly-key', updatedAt: '2026-01-01T00:00:00.000Z' })),
        },
      }
    })
    const store = new ServeSecretsStore({ broker })

    await store.warm()

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(`http://cloud.test/v1/sandboxes/${THREAD}/broker/secrets`)
    const names = (calls[0]?.body as { names: string[] }).names
    expect(names).toContain(secretNameOf(EWebSearchBackend.Tavily))
    expect(store.read(secretNameOf(EWebSearchBackend.Tavily))).toBe('tvly-key')
    expect(store.read('anything-else')).toBeUndefined()
  })

  it('refuses writes', () => {
    const { broker } = brokerWith(() => ({ status: 200, body: {} }))
    const store = new ServeSecretsStore({ broker })

    expect(() => store.write({ name: 'a', value: 'b' })).toThrow(/operator's machine/)
    expect(() => store.remove('a')).toThrow(/operator's machine/)
  })
})
