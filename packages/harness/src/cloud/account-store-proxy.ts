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

import { AccountSnapshot } from './account-snapshot'
import { CachingAccountStore } from './caching-account-store'
import { cloudClientFor } from './cloud-client'
import type { CloudSessionStore } from './cloud-session'
import { RemoteAccountStore } from './remote-account-store'
import type { SealedSnapshotFile } from './sealed-snapshot-file'
import { SignedInAccountStore } from './signed-in-account-store'

/**
 * Signed in, the cloud is the store and stays the store: an outage serves the last inventory the
 * cloud gave (in memory, then the sealed snapshot on disk), never the local vault. Signing in
 * migrates that vault up and archives it; while signed out, the local vault serves.
 */
export class AccountStoreProxy extends AccountStorePort {
  private readonly local: AccountStorePort
  private readonly sessions: CloudSessionStore
  private readonly clientVersion: string | undefined
  private readonly clock: ClockPort | undefined
  private readonly snapshotFile: SealedSnapshotFile | undefined
  private remote: { token: string; store: AccountStorePort } | undefined

  constructor(args: {
    local: AccountStorePort
    sessions: CloudSessionStore
    clientVersion?: string
    clock?: ClockPort
    snapshotFile?: SealedSnapshotFile | undefined
  }) {
    super()
    this.local = args.local
    this.sessions = args.sessions
    this.clientVersion = args.clientVersion
    this.clock = args.clock
    this.snapshotFile = args.snapshotFile
    this.sessions.onCleared(() => {
      this.remote = undefined
      this.snapshotFile?.remove()
    })
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

  forgetCloudCache(): void {
    this.remote = undefined
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
      const cloud =
        this.clock === undefined
          ? remote
          : new CachingAccountStore({
              remote,
              clock: this.clock,
              ...(this.snapshotFile === undefined
                ? {}
                : {
                    snapshot: new AccountSnapshot({
                      file: this.snapshotFile,
                      url: session.url,
                    }),
                  }),
            })
      this.remote = {
        token: session.token,
        store: new SignedInAccountStore({ cloud, local: this.local }),
      }
    }

    return this.remote.store
  }
}
