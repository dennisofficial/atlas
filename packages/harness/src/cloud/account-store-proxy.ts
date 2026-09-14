import {
  AccountStorePort,
  type Account,
  type AccountDraft,
  type AccountId,
  type AccountSecret,
  type EAccountStatus,
  type EAuthProvider,
  type StoredAccount,
} from '@dltech/atlas-core'

import { CloudClient } from './cloud-client'
import type { CloudSessionStore } from './cloud-session'
import { RemoteAccountStore } from './remote-account-store'

export class AccountStoreProxy extends AccountStorePort {
  private readonly local: AccountStorePort
  private readonly sessions: CloudSessionStore
  private remote: { token: string; store: RemoteAccountStore } | undefined

  constructor(args: { local: AccountStorePort; sessions: CloudSessionStore }) {
    super()
    this.local = args.local
    this.sessions = args.sessions
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

  private current(): AccountStorePort {
    const session = this.sessions.read()
    if (session === null) return this.local

    if (this.remote?.token !== session.token) {
      this.remote = {
        token: session.token,
        store: new RemoteAccountStore({
          client: new CloudClient({ url: session.url, token: session.token }),
        }),
      }
    }

    return this.remote.store
  }
}
