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
import { CloudError } from './cloud-transport'
import { RemoteAccountStore } from './remote-account-store'
import { CloudSignInRequiredError } from './sign-in-required'

export const CLOUD_OUTAGE_COOLDOWN_MS = 30_000

export type CloudOutage = { status: number; message: string }

export type OutageListener = (outage: CloudOutage) => void

const outageOf = (error: unknown): CloudOutage | null => {
  if (!(error instanceof CloudError)) return null
  if (error.status !== 0 && error.status < 500) return null

  return { status: error.status, message: error.message }
}

export class AccountStoreProxy extends AccountStorePort {
  private readonly local: AccountStorePort
  private readonly sessions: CloudSessionStore
  private readonly clientVersion: string | undefined
  private readonly cloudRequired: () => boolean
  private readonly now: () => number
  private readonly listeners = new Set<OutageListener>()
  private remote: { token: string; store: RemoteAccountStore } | undefined
  private outageUntil = 0
  private outage: CloudOutage | null = null

  constructor(args: {
    local: AccountStorePort
    sessions: CloudSessionStore
    clientVersion?: string
    cloudRequired?: () => boolean
    now?: () => number
  }) {
    super()
    this.local = args.local
    this.sessions = args.sessions
    this.clientVersion = args.clientVersion
    this.cloudRequired = args.cloudRequired ?? (() => false)
    this.now = args.now ?? (() => Date.now())
  }

  list(): Promise<readonly Account[]> {
    if (this.signedOutOfRequiredCloud()) return Promise.resolve([])
    return this.through((store) => store.list())
  }

  read(accountId: AccountId): Promise<StoredAccount | undefined> {
    return this.through((store) => store.read(accountId))
  }

  add(draft: AccountDraft): Promise<Account> {
    return this.through((store) => store.add(draft))
  }

  replaceSecret(args: { accountId: AccountId; secret: AccountSecret }): Promise<void> {
    return this.through((store) => store.replaceSecret(args))
  }

  setStatus(args: { accountId: AccountId; status: EAccountStatus }): Promise<void> {
    return this.through((store) => store.setStatus(args))
  }

  remove(accountId: AccountId): Promise<void> {
    return this.through((store) => store.remove(accountId))
  }

  setActive(args: { provider: EAuthProvider; accountId: AccountId }): Promise<void> {
    return this.through((store) => store.setActive(args))
  }

  activeFor(provider: EAuthProvider): Promise<AccountId | undefined> {
    if (this.signedOutOfRequiredCloud()) return Promise.resolve(undefined)
    return this.through((store) => store.activeFor(provider))
  }

  degraded(): CloudOutage | null {
    return this.now() < this.outageUntil ? this.outage : null
  }

  watchOutages(listener: OutageListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private through<T>(operation: (store: AccountStorePort) => Promise<T>): Promise<T> {
    const store = this.current()
    if (store === this.local) return operation(store)

    return operation(store).then(
      (outcome) => {
        this.outageUntil = 0
        this.outage = null
        return outcome
      },
      (error: unknown) => {
        const outage = outageOf(error)
        if (outage === null || this.cloudRequired()) throw error

        this.fallBack(outage)
        return operation(this.local)
      },
    )
  }

  private fallBack(outage: CloudOutage): void {
    const announce = this.outage === null || this.outage.message !== outage.message
    this.outage = outage
    this.outageUntil = this.now() + CLOUD_OUTAGE_COOLDOWN_MS
    if (announce) for (const listener of this.listeners) listener(outage)
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

    if (this.degraded() !== null) return this.local

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
