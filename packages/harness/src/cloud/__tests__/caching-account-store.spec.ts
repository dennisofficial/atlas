import { describe, expect, it } from 'bun:test'

import {
  AccountStorePort,
  ClockPort,
  EAccountOrigin,
  EAccountStatus,
  EAuthKind,
  EAuthProvider,
  toAccountId,
  type Account,
  type AccountDraft,
  type AccountId,
  type AccountSecret,
  type StoredAccount,
} from '@dltech/atlas-core'

import { CachingAccountStore } from '../caching-account-store'
import { CloudError } from '../cloud-transport'

const TTL_MS = 60_000

const secret: AccountSecret = { kind: EAuthKind.ApiKey, apiKey: 'sk-test' }

const account: Account = {
  id: toAccountId('acc_1'),
  provider: EAuthProvider.Anthropic,
  kind: EAuthKind.ApiKey,
  origin: EAccountOrigin.Login,
  label: 'work',
  status: EAccountStatus.Active,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const stored: StoredAccount = { ...account, secret }

class MutableClock extends ClockPort {
  private ms = Date.parse('2026-09-16T12:00:00.000Z')

  now(): string {
    return new Date(this.ms).toISOString()
  }

  advance(ms: number): void {
    this.ms += ms
  }
}

class FakeRemoteStore extends AccountStorePort {
  readonly calls: string[] = []
  failure: Error | undefined

  list(): Promise<readonly Account[]> {
    return this.track('list', () => [account])
  }

  read(accountId: AccountId): Promise<StoredAccount | undefined> {
    return this.track(`read:${accountId}`, () => stored)
  }

  add(_draft: AccountDraft): Promise<Account> {
    return this.track('add', () => account)
  }

  replaceSecret(_args: { accountId: AccountId; secret: AccountSecret }): Promise<void> {
    return this.track('replaceSecret', () => undefined)
  }

  setStatus(_args: { accountId: AccountId; status: EAccountStatus }): Promise<void> {
    return this.track('setStatus', () => undefined)
  }

  remove(_accountId: AccountId): Promise<void> {
    return this.track('remove', () => undefined)
  }

  setActive(_args: { provider: EAuthProvider; accountId: AccountId }): Promise<void> {
    return this.track('setActive', () => undefined)
  }

  activeFor(provider: EAuthProvider): Promise<AccountId | undefined> {
    return this.track(`activeFor:${provider}`, () => account.id)
  }

  private track<T>(label: string, value: () => T): Promise<T> {
    this.calls.push(label)
    if (this.failure !== undefined) return Promise.reject(this.failure)
    return Promise.resolve(value())
  }
}

const unavailable = new CloudError({ status: 504, message: 'gateway timeout' })

const setup = () => {
  const remote = new FakeRemoteStore()
  const clock = new MutableClock()
  const store = new CachingAccountStore({ remote, clock, ttlMs: TTL_MS })
  return { remote, clock, store }
}

describe('CachingAccountStore', () => {
  it('serves repeat reads from the cache within the TTL', async () => {
    const { remote, store } = setup()

    expect(await store.list()).toEqual([account])
    expect(await store.list()).toEqual([account])
    expect(await store.read(account.id)).toEqual(stored)
    expect(await store.read(account.id)).toEqual(stored)
    expect(await store.activeFor(EAuthProvider.Anthropic)).toBe(account.id)
    expect(await store.activeFor(EAuthProvider.Anthropic)).toBe(account.id)

    expect(remote.calls).toEqual(['list', `read:${account.id}`, `activeFor:${EAuthProvider.Anthropic}`])
  })

  it('refetches once the TTL has passed', async () => {
    const { remote, clock, store } = setup()

    await store.list()
    clock.advance(TTL_MS + 1)
    await store.list()

    expect(remote.calls).toEqual(['list', 'list'])
  })

  it('serves the stale cache when the cloud is unavailable', async () => {
    const { remote, clock, store } = setup()

    expect(await store.list()).toEqual([account])
    expect(await store.read(account.id)).toEqual(stored)
    expect(await store.activeFor(EAuthProvider.Anthropic)).toBe(account.id)

    clock.advance(TTL_MS + 1)
    remote.failure = unavailable

    expect(await store.list()).toEqual([account])
    expect(await store.read(account.id)).toEqual(stored)
    expect(await store.activeFor(EAuthProvider.Anthropic)).toBe(account.id)
  })

  it('rethrows an outage when nothing is cached yet', async () => {
    const { remote, store } = setup()
    remote.failure = unavailable

    await expect(store.list()).rejects.toBe(unavailable)
    await expect(store.read(account.id)).rejects.toBe(unavailable)
    await expect(store.activeFor(EAuthProvider.Anthropic)).rejects.toBe(unavailable)
  })

  it('rethrows errors that are not outages even with a warm cache', async () => {
    const { remote, clock, store } = setup()
    const unauthorized = new CloudError({ status: 401, message: 'expired session' })

    await store.list()
    clock.advance(TTL_MS + 1)
    remote.failure = unauthorized

    await expect(store.list()).rejects.toBe(unauthorized)
  })

  it('invalidates the cache after any write', async () => {
    const { remote, store } = setup()

    await store.list()
    await store.read(account.id)
    await store.activeFor(EAuthProvider.Anthropic)
    await store.setStatus({ accountId: account.id, status: EAccountStatus.Limited })

    remote.calls.length = 0
    await store.list()
    await store.read(account.id)
    await store.activeFor(EAuthProvider.Anthropic)

    expect(remote.calls).toEqual(['list', `read:${account.id}`, `activeFor:${EAuthProvider.Anthropic}`])
  })

  it('never serves a write from the cache', async () => {
    const { remote, store } = setup()
    remote.failure = unavailable

    await expect(
      store.setStatus({ accountId: account.id, status: EAccountStatus.Limited }),
    ).rejects.toBe(unavailable)
  })
})
