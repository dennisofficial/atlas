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

/**
 * Signed in, the cloud is the store and stays the store: an outage surfaces as a failed call,
 * never as a quiet switch to the local vault. Signing in archives that vault, so there is
 * nothing behind it to serve — only the cloud.required-off escape hatch still reads it, and
 * only while signed out.
 */
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
    if (this.signedOutOfRequiredCloud()) return Promise.resolve([])
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
    if (this.signedOutOfRequiredCloud()) return Promise.resolve(undefined)
    return this.current().activeFor(provider)
  }

  private signedOutOfRequiredCloud(): boolean {
    return this.sessions.read() === null && this.cloudRequired()
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
