import type {
  Account,
  AccountId,
  AccountSecret,
  EAccountStatus,
  EAuthProvider,
  StoredAccount,
} from '../credentials/account'

export type AccountDraft = {
  provider: EAuthProvider
  label: string
  secret: AccountSecret
  origin: Account['origin']
  email?: string | undefined
  subscription?: string | undefined
  importedFrom?: string | undefined
}

export class ManualPauseConflictError extends Error {
  constructor(args: { accountId: AccountId; expected: number; actual: number }) {
    super(
      `account ${args.accountId} control generation is ${args.actual}, not the expected ${args.expected}`,
    )
    this.name = 'ManualPauseConflictError'
  }
}

export class ManualPauseUnsupportedError extends Error {
  constructor() {
    super('this account store cannot hold a manual pause')
    this.name = 'ManualPauseUnsupportedError'
  }
}

export abstract class AccountStorePort {
  abstract list(): Promise<readonly Account[]>
  abstract read(accountId: AccountId): Promise<StoredAccount | undefined>
  abstract add(draft: AccountDraft): Promise<Account>
  abstract replaceSecret(args: { accountId: AccountId; secret: AccountSecret }): Promise<void>
  abstract setStatus(args: { accountId: AccountId; status: EAccountStatus }): Promise<void>
  abstract remove(accountId: AccountId): Promise<void>
  abstract setActive(args: { provider: EAuthProvider; accountId: AccountId }): Promise<void>
  abstract activeFor(provider: EAuthProvider): Promise<AccountId | undefined>

  setManualPause(_args: {
    accountId: AccountId
    expectedControlGeneration?: number | undefined
    paused: boolean
  }): Promise<StoredAccount> {
    return Promise.reject(new ManualPauseUnsupportedError())
  }

  withAccountLock<T>(args: { accountId: AccountId; run: () => Promise<T> }): Promise<T> {
    return args.run()
  }
}
