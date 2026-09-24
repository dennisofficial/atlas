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

import { CachingAccountStore } from './caching-account-store'
import { cloudClientFor } from './cloud-client'
import type { CloudSessionStore } from './cloud-session'
import { RemoteAccountStore } from './remote-account-store'

/**
 * Signed in, the cloud is the store and stays the store: an outage surfaces as a failed call,
 * never as a quiet switch to the local vault. Signing in archives that vault, so there is
 * nothing behind it to serve until signing out again; while signed out, the local vault serves.
 */
export class AccountStoreProxy extends AccountStorePort {
  private readonly local: AccountStorePort
  private readonly sessions: CloudSessionStore
  private readonly clientVersion: string | undefined
  private readonly clock: ClockPort | undefined
  private remote: { token: string; store: AccountStorePort } | undefined

  constructor(args: {
    local: AccountStorePort
    sessions: CloudSessionStore
    clientVersion?: string
    clock?: ClockPort
  }) {
    super()
    this.local = args.local
    this.sessions = args.sessions
    this.clientVersion = args.clientVersion
    this.clock = args.clock
  }

  list(): Promise<readonly Account[]> {
    return this.current().list()
  }

  read(accountId: AccountId): Promise<StoredAccount | undefined> {
    return this.current().read(accountId)
  }

  add(draft: AccountDraft): Promise<Account> {
    return this.current().add(draft)
  }

  replaceSecret(args: { accountId: AccountId; secret: AccountSecret }): Promise<void> {
    return this.current().replaceSecret(args)
  }

  setStatus(args: { accountId: AccountId; status: EAccountStatus }): Promise<void> {
    return this.current().setStatus(args)
  }

  remove(accountId: AccountId): Promise<void> {
    return this.current().remove(accountId)
  }

  setActive(args: { provider: EAuthProvider; accountId: AccountId }): Promise<void> {
    return this.current().setActive(args)
  }

  activeFor(provider: EAuthProvider): Promise<AccountId | undefined> {
    return this.current().activeFor(provider)
  }

  /** Drops the cached remote reads, so the next call re-fetches — used when a provider refuses a brokered credential. */
  invalidate(): void {
    if (this.remote?.store instanceof CachingAccountStore) this.remote.store.invalidate()
  }

  private current(): AccountStorePort {
    const session = this.sessions.read()
    if (session === null) return this.local

    if (this.remote?.token !== session.token) {
      const remote = new RemoteAccountStore({
        client: cloudClientFor({
          session,
          ...(this.clientVersion === undefined ? {} : { clientVersion: this.clientVersion }),
        }),
      })
      this.remote = {
        token: session.token,
        store:
          this.clock === undefined
            ? remote
            : new CachingAccountStore({ remote, clock: this.clock }),
      }
    }

    return this.remote.store
  }
}
