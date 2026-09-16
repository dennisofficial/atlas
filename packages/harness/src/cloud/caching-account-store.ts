import {
  AccountStorePort,
  type Account,
  type AccountDraft,
  type AccountId,
  type AccountSecret,
  type ClockPort,
  type EAccountStatus,
  type EAuthProvider,
  type StoredAccount,
} from '@dltech/atlas-core'

import { isCloudUnavailable } from './cloud-transport'

export const ACCOUNT_CACHE_TTL_MS = 60_000

type CacheEntry<T> = { value: T; freshUntilMs: number }

export class CachingAccountStore extends AccountStorePort {
  private readonly remote: AccountStorePort
  private readonly clock: ClockPort
  private readonly ttlMs: number
  private listEntry: CacheEntry<readonly Account[]> | undefined
  private readonly readEntries = new Map<AccountId, CacheEntry<StoredAccount | undefined>>()
  private readonly activeEntries = new Map<EAuthProvider, CacheEntry<AccountId | undefined>>()

  constructor(args: { remote: AccountStorePort; clock: ClockPort; ttlMs?: number }) {
    super()
    this.remote = args.remote
    this.clock = args.clock
    this.ttlMs = args.ttlMs ?? ACCOUNT_CACHE_TTL_MS
  }

  list(): Promise<readonly Account[]> {
    return this.cached({
      entry: () => this.listEntry,
      store: (entry) => {
        this.listEntry = entry
      },
      fetch: () => this.remote.list(),
    })
  }

  read(accountId: AccountId): Promise<StoredAccount | undefined> {
    return this.cached({
      entry: () => this.readEntries.get(accountId),
      store: (entry) => {
        this.readEntries.set(accountId, entry)
      },
      fetch: () => this.remote.read(accountId),
    })
  }

  activeFor(provider: EAuthProvider): Promise<AccountId | undefined> {
    return this.cached({
      entry: () => this.activeEntries.get(provider),
      store: (entry) => {
        this.activeEntries.set(provider, entry)
      },
      fetch: () => this.remote.activeFor(provider),
    })
  }

  async add(draft: AccountDraft): Promise<Account> {
    const account = await this.remote.add(draft)
    this.invalidate()
    return account
  }

  async replaceSecret(args: { accountId: AccountId; secret: AccountSecret }): Promise<void> {
    await this.remote.replaceSecret(args)
    this.invalidate()
  }

  async setStatus(args: { accountId: AccountId; status: EAccountStatus }): Promise<void> {
    await this.remote.setStatus(args)
    this.invalidate()
  }

  async remove(accountId: AccountId): Promise<void> {
    await this.remote.remove(accountId)
    this.invalidate()
  }

  async setActive(args: { provider: EAuthProvider; accountId: AccountId }): Promise<void> {
    await this.remote.setActive(args)
    this.invalidate()
  }

  private async cached<T>(args: {
    entry: () => CacheEntry<T> | undefined
    store: (entry: CacheEntry<T>) => void
    fetch: () => Promise<T>
  }): Promise<T> {
    const hit = args.entry()
    if (hit !== undefined && this.nowMs() < hit.freshUntilMs) return hit.value

    try {
      const value = await args.fetch()
      args.store({ value, freshUntilMs: this.nowMs() + this.ttlMs })
      return value
    } catch (error) {
      if (!isCloudUnavailable(error) || hit === undefined) throw error
      return hit.value
    }
  }

  private invalidate(): void {
    this.listEntry = undefined
    this.readEntries.clear()
    this.activeEntries.clear()
  }

  private nowMs(): number {
    return Date.parse(this.clock.now())
  }
}
