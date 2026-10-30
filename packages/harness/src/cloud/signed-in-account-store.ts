import {
  AccountStorePort,
  EAccountOrigin,
  type Account,
  type AccountDraft,
  type AccountId,
  type AccountSecret,
  type EAccountStatus,
  type EAuthProvider,
  type StoredAccount,
} from '@dltech/atlas-core'

import { isCloudUnavailable } from './cloud-transport'

const isEnvironment = (account: Account | undefined): boolean =>
  account?.origin === EAccountOrigin.Environment

export class SignedInAccountStore extends AccountStorePort {
  private readonly cloud: AccountStorePort
  private readonly local: AccountStorePort

  constructor(args: { cloud: AccountStorePort; local: AccountStorePort }) {
    super()
    this.cloud = args.cloud
    this.local = args.local
  }

  async list(): Promise<readonly Account[]> {
    const environment = (await this.local.list()).filter(isEnvironment)
    const cloud = await this.cloud.list().catch((error: unknown) => {
      if (isCloudUnavailable(error) && environment.length > 0) return []
      throw error
    })
    return [...cloud, ...environment]
  }

  async read(accountId: AccountId): Promise<StoredAccount | undefined> {
    return (await this.environmentAccount(accountId)) ?? this.cloud.read(accountId)
  }

  add(draft: AccountDraft): Promise<Account> {
    return this.cloud.add(draft)
  }

  async replaceSecret(args: { accountId: AccountId; secret: AccountSecret }): Promise<void> {
    await (await this.owner(args.accountId)).replaceSecret(args)
  }

  async setStatus(args: { accountId: AccountId; status: EAccountStatus }): Promise<void> {
    await (await this.owner(args.accountId)).setStatus(args)
  }

  async remove(accountId: AccountId): Promise<void> {
    await (await this.owner(accountId)).remove(accountId)
  }

  async setActive(args: { provider: EAuthProvider; accountId: AccountId }): Promise<void> {
    if ((await this.environmentAccount(args.accountId)) === undefined) {
      await this.cloud.setActive(args)
    }
    await this.local.setActive(args)
  }

  async activeFor(provider: EAuthProvider): Promise<AccountId | undefined> {
    const local = await this.local.activeFor(provider)
    if (local !== undefined && (await this.environmentAccount(local)) !== undefined) return local
    return this.cloud.activeFor(provider).catch((error: unknown) => {
      if (isCloudUnavailable(error)) return undefined
      throw error
    })
  }

  override async withAccountLock<T>(args: {
    accountId: AccountId
    run: () => Promise<T>
  }): Promise<T> {
    return (await this.owner(args.accountId)).withAccountLock(args)
  }

  private async environmentAccount(accountId: AccountId): Promise<StoredAccount | undefined> {
    const stored = await this.local.read(accountId)
    return isEnvironment(stored) ? stored : undefined
  }

  private async owner(accountId: AccountId): Promise<AccountStorePort> {
    return (await this.environmentAccount(accountId)) === undefined ? this.cloud : this.local
  }
}
