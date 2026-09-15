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

import { cloudClientFor } from './cloud-client'
import type { CloudSessionStore } from './cloud-session'
import { RemoteAccountStore } from './remote-account-store'
import { CloudSignInRequiredError } from './sign-in-required'

export class AccountStoreProxy extends AccountStorePort {
  private readonly local: AccountStorePort
  private readonly sessions: CloudSessionStore
  private readonly clientVersion: string | undefined
  private readonly cloudRequired: () => boolean
  private remote: { token: string; store: RemoteAccountStore } | undefined

  constructor(args: {
    local: AccountStorePort
    sessions: CloudSessionStore
    clientVersion?: string
    cloudRequired?: () => boolean
  }) {
    super()
    this.local = args.local
    this.sessions = args.sessions
    this.clientVersion = args.clientVersion
    this.cloudRequired = args.cloudRequired ?? (() => false)
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
    if (session === null) {
      if (this.cloudRequired()) throw new CloudSignInRequiredError()
      return this.local
    }

    if (this.remote?.token !== session.token) {
      this.remote = {
        token: session.token,
        store: new RemoteAccountStore({
          client: cloudClientFor({
            session,
            ...(this.clientVersion === undefined ? {} : { clientVersion: this.clientVersion }),
          }),
        }),
      }
    }

    return this.remote.store
  }
}
