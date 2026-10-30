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

import type { AccountSnapshot, Recalled } from './account-snapshot'
import { isCloudRefusal, isCloudUnavailable } from './cloud-transport'

export const ACCOUNT_CACHE_TTL_MS = 60_000

type CacheEntry<T> = { value: T; freshUntilMs: number }

export class CachingAccountStore extends AccountStorePort {
  private readonly remote: AccountStorePort
  private readonly clock: ClockPort
  private readonly ttlMs: number
  private readonly snapshot: AccountSnapshot | undefined
  private listEntry: CacheEntry<readonly Account[]> | undefined
  private readonly readEntries = new Map<AccountId, CacheEntry<StoredAccount | undefined>>()
  private readonly activeEntries = new Map<EAuthProvider, CacheEntry<AccountId | undefined>>()

  constructor(args: {
    remote: AccountStorePort
    clock: ClockPort
    ttlMs?: number
    snapshot?: AccountSnapshot | undefined
  }) {
    super()
    this.remote = args.remote
    this.clock = args.clock
    this.ttlMs = args.ttlMs ?? ACCOUNT_CACHE_TTL_MS
    this.snapshot = args.snapshot
  }

  list(): Promise<readonly Account[]> {
    return this.cached({
      entry: () => this.listEntry,
      store: (entry) => {
        this.listEntry = entry
      },
      fetch: () => this.remote.list(),
      record: (list) => this.snapshot?.recordList(list),
      recall: () => this.snapshot?.recallList(),
    })
  }

  read(accountId: AccountId): Promise<StoredAccount | undefined> {
    return this.cached({
      entry: () => this.readEntries.get(accountId),
      store: (entry) => {
        this.readEntries.set(accountId, entry)
      },
      fetch: () => this.remote.read(accountId),
      record: (stored) => this.snapshot?.recordRead({ accountId, stored }),
      recall: () => this.snapshot?.recallRead(accountId),
    })
  }

  activeFor(provider: EAuthProvider): Promise<AccountId | undefined> {
    return this.cached({
      entry: () => this.activeEntries.get(provider),
      store: (entry) => {
        this.activeEntries.set(provider, entry)
      },
      fetch: () => this.remote.activeFor(provider),
      record: (accountId) => this.snapshot?.recordActive({ provider, accountId }),
      recall: () => this.snapshot?.recallActive(provider),
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
    record: (value: T) => void
    recall: () => Recalled<T>
  }): Promise<T> {
    const hit = args.entry()
    if (hit !== undefined && this.nowMs() < hit.freshUntilMs) return hit.value

    try {
      const value = await args.fetch()
      args.store({ value, freshUntilMs: this.nowMs() + this.ttlMs })
      args.record(value)
      return value
    } catch (error) {
      // A refusal ends the session the cache was filled under: nothing it holds may serve again,
      // and the proxy above is what tells the operator. An outage keeps serving what is held.
      if (isCloudRefusal(error)) this.invalidate()
      if (!isCloudUnavailable(error)) throw error
      if (hit !== undefined) return hit.value
      const recalled = args.recall()
      if (recalled === undefined) throw error
      return recalled.value
    }
  }

  invalidate(): void {
    this.listEntry = undefined
    this.readEntries.clear()
    this.activeEntries.clear()
  }

  private nowMs(): number {
    return Date.parse(this.clock.now())
  }
}
