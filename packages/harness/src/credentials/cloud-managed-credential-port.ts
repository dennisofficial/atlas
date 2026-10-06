import {
  authorityOf,
  chooseAccount,
  CredentialPort,
  EAccountChoice,
  EAuthKind,
  EAuthProvider,
  ENoAccountReason,
  type AccountId,
  type AccountSecret,
  type AccountStorePort,
  type ClockPort,
  type Credential,
  type CredentialRequest,
  type OauthAuthority,
  type StoredAccount,
} from '@dltech/atlas-core'

import type { CloudSession } from '../cloud/cloud-session'
import {
  oauthConnectionsClientFor,
  type OAuthConnectionsClient,
} from '../cloud/oauth-connections-client'
import {
  changedUnderneath,
  credentialErrorOf,
  expired,
  isTransient,
  noAccount,
  otherAuthority,
  signInToCloud,
} from './cloud-credential-errors'

import { CredentialError, ECredentialFailure } from './credential-error'
import { OauthHandoff } from './oauth-handoff'
import { OauthHandoffWork } from './oauth-handoff-work'
import { prepareOauthReplacement } from './oauth-replacement'
import { isOauthHandoffCandidate } from './oauth-eligibility'
import {
  DEFAULT_REFRESH_LEAD_MS,
  isPending,
  millisOf,
  persistAccess,
  sameUrl,
} from './oauth-owned-secret'

type OwnedOauth = { stored: StoredAccount; authority: OauthAuthority }

const credentialOf = (stored: StoredAccount): Credential =>
  stored.secret.kind === EAuthKind.ApiKey
    ? { kind: EAuthKind.ApiKey, accountId: stored.id, apiKey: stored.secret.apiKey }
    : {
        kind: EAuthKind.Oauth,
        accountId: stored.id,
        accessToken: stored.secret.tokens.accessToken,
        expiresAt: stored.secret.tokens.expiresAt,
        providerAccountId: stored.secret.tokens.accountId,
      }

export class CloudManagedCredentialPort extends CredentialPort {
  private readonly accounts: AccountStorePort
  private readonly local: CredentialPort
  private readonly clock: ClockPort
  private readonly session: () => CloudSession | null
  private readonly clients: (session: CloudSession) => OAuthConnectionsClient
  private readonly handoff: OauthHandoff
  private readonly handoffWork: OauthHandoffWork
  private readonly defaultProvider: EAuthProvider
  private readonly rejected = new Map<AccountId, string>()
  private readonly minting = new Map<string, Promise<StoredAccount>>()

  constructor(args: {
    accounts: AccountStorePort
    local: CredentialPort
    clock: ClockPort
    session: () => CloudSession | null
    clientVersion?: string | undefined
    fetchFn?: typeof fetch | undefined
    defaultProvider?: EAuthProvider | undefined
    clients?: ((session: CloudSession) => OAuthConnectionsClient) | undefined
    newConnectionId?: (() => string) | undefined
    onHandoffFailure?: ((error: CredentialError) => void) | undefined
  }) {
    super()
    this.accounts = args.accounts
    this.local = args.local
    this.clock = args.clock
    this.session = args.session
    this.defaultProvider = args.defaultProvider ?? EAuthProvider.Anthropic
    this.clients =
      args.clients ??
      ((session) =>
        oauthConnectionsClientFor({
          session,
          clientVersion: args.clientVersion,
          fetchFn: args.fetchFn,
        }))
    this.handoff = new OauthHandoff({
      accounts: args.accounts,
      clock: args.clock,
      clients: this.clients,
      newConnectionId: args.newConnectionId,
    })
    this.handoffWork = new OauthHandoffWork({ handoff: this.handoff, clock: args.clock, onFailure: args.onHandoffFailure })
  }

  async read(request?: CredentialRequest): Promise<Credential> {
    const provider = request?.provider ?? this.defaultProvider
    const chosen = await this.chosenAccount({ provider, accountId: request?.accountId })
    if (chosen.secret.kind === EAuthKind.ApiKey)
      return this.local.read({ provider, accountId: chosen.id })

    const session = this.session()
    const authority = authorityOf(chosen.secret)
    if (authority === undefined && session === null)
      return this.local.read({ provider, accountId: chosen.id })

    const owned = await this.owned({ chosen, session })

    return credentialOf(await this.current({ owned, session }))
  }

  async discard(credential: Credential): Promise<void> {
    if (credential.kind === EAuthKind.Oauth) this.rejected.set(credential.accountId, credential.accessToken)
    await this.local.discard(credential)
  }

  async handoffAll(session: CloudSession, accountIds?: readonly AccountId[]): Promise<void> {
    const failures: string[] = []
    for (const account of await this.accounts.list()) {
      if (account.kind !== EAuthKind.Oauth || (accountIds !== undefined && !accountIds.includes(account.id))) continue
      const stored = await this.accounts.read(account.id)
      if (stored === undefined || !isOauthHandoffCandidate({ stored, cloudUrl: session.url })) continue
      try {
        await this.handoff.transfer({ accountId: account.id, session })
      } catch (error) {
        failures.push(`${account.label}: ${credentialErrorOf(error).message}`)
      }
    }
    if (failures.length === 0) return

    throw new CredentialError({
      failure: ECredentialFailure.StoreUnavailable,
      message: `Atlas Cloud has not taken ownership of every OAuth login yet. ${failures.join(' ')}`,
    })
  }

  prepareReplacement(args: { accountId: AccountId; secret: AccountSecret }): Promise<AccountSecret> {
    return prepareOauthReplacement({ ...args, accounts: this.accounts, session: this.session(), client: this.clients })
  }

  private async owned(args: { chosen: StoredAccount; session: CloudSession | null }): Promise<OwnedOauth> {
    const existing = authorityOf(args.chosen.secret)
    const session = args.session
    const needsTransfer =
      session !== null &&
      (existing === undefined || (isPending(args.chosen) && sameUrl(existing.url, session.url)))

    let stored = args.chosen
    if (needsTransfer) {
      try {
        stored = await this.handoff.fence({ accountId: args.chosen.id, session })
        if (isPending(stored) && this.cachedUsable(stored)) {
          this.handoffWork.enqueue({ accountId: stored.id, session })
        } else {
          stored = await this.handoff.transfer({ accountId: stored.id, session })
        }
      } catch (error) {
        const current = await this.accounts.read(args.chosen.id)
        const authority = current === undefined ? undefined : authorityOf(current.secret)
        if (isTransient(error) && current !== undefined && authority !== undefined && this.cachedUsable(current)) {
          return { stored: current, authority }
        }
        throw credentialErrorOf(error)
      }
    }
    const authority = authorityOf(stored.secret)
    if (authority === undefined) throw expired(stored)

    return { stored, authority }
  }

  private async current(args: {
    owned: OwnedOauth
    session: CloudSession | null
  }): Promise<StoredAccount> {
    const { stored, authority } = args.owned
    const session = args.session
    const usable = this.cachedUsable(stored)

    if (session === null) {
      if (usable) return stored
      throw signInToCloud(stored)
    }
    if (!sameUrl(authority.url, session.url)) throw otherAuthority(stored)
    if (usable && (isPending(stored) || this.isFresh(stored))) return stored

    try {
      return await this.mint({ stored, authority, session })
    } catch (error) {
      if (isTransient(error) && usable) return stored
      throw credentialErrorOf(error)
    }
  }

  private mint(args: {
    stored: StoredAccount
    authority: OauthAuthority
    session: CloudSession
  }): Promise<StoredAccount> {
    const key = `${args.stored.id}:${args.authority.connectionId}`
    const running = this.minting.get(key)
    if (running !== undefined) return running

    const work = this.exchange(args).finally(() => {
      this.minting.delete(key)
    })
    this.minting.set(key, work)

    return work
  }

  private async exchange(args: {
    stored: StoredAccount
    authority: OauthAuthority
    session: CloudSession
  }): Promise<StoredAccount> {
    const held = args.stored.secret.kind === EAuthKind.Oauth ? args.stored.secret.tokens.accessToken : ''
    const rejected = this.rejected.get(args.stored.id)

    const access = await this.clients(args.session).accessToken({
      connectionId: args.authority.connectionId,
      ...(rejected !== undefined && rejected === held ? { rejectedAccessToken: rejected } : {}),
    })
    if (access.accessToken !== rejected) this.rejected.delete(args.stored.id)

    const persisted = await persistAccess({
      accounts: this.accounts,
      accountId: args.stored.id,
      connectionId: args.authority.connectionId,
      authorizationId: args.authority.authorizationId,
      settlesPending: false,
      access,
      nowMs: () => Date.parse(this.clock.now()),
    })
    if (persisted === undefined) throw changedUnderneath(args.stored)

    return persisted
  }

  private cachedUsable(stored: StoredAccount): boolean {
    if (stored.secret.kind !== EAuthKind.Oauth) return false
    if (this.rejected.get(stored.id) === stored.secret.tokens.accessToken) return false

    const expiresAtMs = millisOf(stored.secret.tokens.expiresAt)

    return expiresAtMs !== null && Date.parse(this.clock.now()) < expiresAtMs
  }

  private isFresh(stored: StoredAccount): boolean {
    if (stored.secret.kind !== EAuthKind.Oauth || isPending(stored)) return false

    const expiresAtMs = millisOf(stored.secret.tokens.expiresAt)
    if (expiresAtMs === null) return false

    const dueMs = millisOf(authorityOf(stored.secret)?.refreshAfter) ?? expiresAtMs - DEFAULT_REFRESH_LEAD_MS

    return Date.parse(this.clock.now()) < Math.min(dueMs, expiresAtMs)
  }

  private async chosenAccount(args: {
    provider: EAuthProvider
    accountId: AccountId | undefined
  }): Promise<StoredAccount> {
    const preferred = args.accountId ?? (await this.accounts.activeFor(args.provider))
    const choice = chooseAccount({
      accounts: await this.accounts.list(),
      provider: args.provider,
      preferred,
    })
    if (choice.type === EAccountChoice.Refused) throw noAccount(args.provider, choice.reason)

    const stored = await this.accounts.read(choice.account.id)
    if (stored === undefined) throw noAccount(args.provider, ENoAccountReason.NoneForProvider)

    return stored
  }
}
