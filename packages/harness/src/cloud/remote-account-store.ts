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

import type { CloudClient } from './cloud-client'

export class RemoteAccountStore extends AccountStorePort {
  private readonly client: CloudClient

  constructor(args: { client: CloudClient }) {
    super()
    this.client = args.client
  }

  list(): Promise<readonly Account[]> {
    return this.client.listAccounts()
  }

  read(accountId: AccountId): Promise<StoredAccount | undefined> {
    return this.client.readAccount({ accountId })
  }

  add(draft: AccountDraft): Promise<Account> {
    return this.client.addAccount({ draft })
  }

  replaceSecret(args: { accountId: AccountId; secret: AccountSecret }): Promise<void> {
    return this.client.replaceAccountSecret(args)
  }

  setStatus(args: { accountId: AccountId; status: EAccountStatus }): Promise<void> {
    return this.client.setAccountStatus(args)
  }

  remove(accountId: AccountId): Promise<void> {
    return this.client.removeAccount({ accountId })
  }

  setActive(args: { provider: EAuthProvider; accountId: AccountId }): Promise<void> {
    return this.client.setActiveAccount(args)
  }

  activeFor(provider: EAuthProvider): Promise<AccountId | undefined> {
    return this.client.activeAccount({ provider })
  }
}
