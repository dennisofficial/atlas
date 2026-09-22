import {
  AccountStorePort,
  EAccountStatus,
  EAuthProvider,
  type Account,
  type AccountDraft,
  type AccountId,
  type AccountSecret,
} from '@dltech/atlas-core'

import { CloudError } from '../cloud/cloud-transport'

import type { ServeBrokerClient } from './serve-broker-client'

const NO_WRITES =
  'accounts are managed on the operator\'s machine — a cloud session cannot change them from inside its sandbox'

/**
 * The refusal rides a 403 CloudError because the boot-time reconciliation in `bindAccounts`
 * (environment accounts, keychain import) downgrades exactly that shape to a notice — a sandbox
 * that cannot mutate the account store must still boot.
 */
const refused = (): Promise<never> =>
  Promise.reject(new CloudError({ status: 403, message: NO_WRITES }))

/**
 * Account metadata rides the thread-scoped broker: the boot-time model binding needs the list and
 * the active pointers, and neither discloses a secret. Everything that would mutate the store or
 * read a sealed secret has no sandbox-facing route and refuses here.
 */
export class ServeAccountStore extends AccountStorePort {
  private readonly broker: ServeBrokerClient
  private snapshot: { accounts: Account[]; active: Map<EAuthProvider, AccountId> } | undefined
  private loading: Promise<{ accounts: Account[]; active: Map<EAuthProvider, AccountId> }> | undefined

  constructor(args: { broker: ServeBrokerClient }) {
    super()
    this.broker = args.broker
  }

  async list(): Promise<readonly Account[]> {
    return (await this.current()).accounts
  }

  async activeFor(provider: EAuthProvider): Promise<AccountId | undefined> {
    return (await this.current()).active.get(provider)
  }

  read(_accountId: AccountId): Promise<never> {
    return refused()
  }

  add(_draft: AccountDraft): Promise<never> {
    return refused()
  }

  replaceSecret(_args: { accountId: AccountId; secret: AccountSecret }): Promise<never> {
    return refused()
  }

  setStatus(_args: { accountId: AccountId; status: EAccountStatus }): Promise<never> {
    return refused()
  }

  remove(_accountId: AccountId): Promise<never> {
    return refused()
  }

  setActive(_args: { provider: EAuthProvider; accountId: AccountId }): Promise<never> {
    return refused()
  }

  private current(): Promise<{ accounts: Account[]; active: Map<EAuthProvider, AccountId> }> {
    if (this.snapshot !== undefined) return Promise.resolve(this.snapshot)
    this.loading ??= this.broker.accounts().then((body) => {
      this.snapshot = {
        accounts: body.accounts,
        active: new Map(body.active.map((pointer) => [pointer.provider, pointer.accountId])),
      }
      return this.snapshot
    })
    return this.loading
  }
}
