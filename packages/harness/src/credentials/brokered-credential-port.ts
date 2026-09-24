import {
  chooseAccount,
  CredentialPort,
  DEFAULT_REFRESH_SKEW_MS,
  EAccountChoice,
  EAuthKind,
  EAuthProvider,
  ENoAccountReason,
  type AccountId,
  type AccountStorePort,
  type ClockPort,
  type Credential,
  type CredentialRequest,
  type StoredAccount,
} from '@dltech/atlas-core'

import { cloudClientFor, type BrokeredAccessToken } from '../cloud/cloud-client'
import type { CloudSession, CloudSessionStore } from '../cloud/cloud-session'
import { isCloudUnavailable } from '../cloud/cloud-transport'
import { CredentialError, ECredentialFailure } from './credential-error'

const SIGN_IN = 'Sign in with /auth.'

type MintedToken = {
  accessToken: string
  expiresAt: string | null
  freshUntilMs: number
  usableUntilMs: number
}

const credentialOf = (args: { stored: StoredAccount; minted: MintedToken }): Credential => {
  const { secret, id } = args.stored
  if (secret.kind === EAuthKind.ApiKey)
    return { kind: EAuthKind.ApiKey, accountId: id, apiKey: args.minted.accessToken }

  return {
    kind: EAuthKind.Oauth,
    accountId: id,
    accessToken: args.minted.accessToken,
    expiresAt: args.minted.expiresAt ?? secret.tokens.expiresAt,
    providerAccountId: secret.tokens.accountId,
  }
}

const expiryMillisOf = (expiresAt: string | null): number | null => {
  if (expiresAt === null) return null
  const parsed = Date.parse(expiresAt)
  return Number.isNaN(parsed) ? null : parsed
}

/**
 * Credentials come from the cloud broker, which is the only refresher: a read returns the
 * account's usable access token, and the API rotates the OAuth pair itself when the token
 * nears expiry. Nothing here refreshes locally — two clients refreshing the same account
 * race and invalidate each other, which is the whole reason the broker exists.
 *
 * A minted token is held until it nears expiry, so an API outage shorter than the token's
 * life costs nothing: reads keep answering from what was already minted, and only a token
 * that has actually expired turns an outage into a failed turn.
 */
export class BrokeredCredentialPort extends CredentialPort {
  private readonly accounts: AccountStorePort
  private readonly sessions: CloudSessionStore
  private readonly clock: ClockPort
  private readonly clientVersion: string | undefined
  private readonly rejected = new Map<AccountId, string>()
  private readonly held = new Map<AccountId, MintedToken>()
  private readonly minting = new Map<AccountId, Promise<MintedToken>>()
  private readonly defaultProvider: EAuthProvider
  private readonly fetchFn: typeof fetch | undefined
  private readonly onCredentialsRefused: (() => void) | undefined
  private sessionToken: string | undefined

  constructor(args: {
    accounts: AccountStorePort
    sessions: CloudSessionStore
    clock: ClockPort
    clientVersion?: string
    defaultProvider?: EAuthProvider
    fetchFn?: typeof fetch
    onCredentialsRefused?: () => void
  }) {
    super()
    this.accounts = args.accounts
    this.sessions = args.sessions
    this.clock = args.clock
    this.clientVersion = args.clientVersion
    this.defaultProvider = args.defaultProvider ?? EAuthProvider.Anthropic
    this.fetchFn = args.fetchFn
    this.onCredentialsRefused = args.onCredentialsRefused
  }

  async read(request?: CredentialRequest): Promise<Credential> {
    const provider = request?.provider ?? this.defaultProvider
    const stored = await this.chosenAccount({ provider, accountId: request?.accountId })

    const session = this.sessions.read()
    if (session === null) throw this.noAccount(provider, ENoAccountReason.NoneForProvider)
    this.forgetTokensOfOtherSession(session.token)

    const minted = await this.tokenFor({ session, accountId: stored.id })

    return credentialOf({ stored, minted })
  }

  async discard(credential: Credential): Promise<void> {
    const dropped = this.held.delete(credential.accountId)
    if (credential.kind === EAuthKind.Oauth) {
      this.rejected.set(credential.accountId, credential.accessToken)
    }
    // A provider refused the token the cloud brokered, so every cloud-held cache is suspect:
    // the re-read after this discard must miss them, not be served the same refused state.
    if (dropped) this.onCredentialsRefused?.()
  }

  private tokenFor(args: { session: CloudSession; accountId: AccountId }): Promise<MintedToken> {
    const held = this.held.get(args.accountId)
    if (held !== undefined && this.nowMs() < held.freshUntilMs) return Promise.resolve(held)

    const inFlight = this.minting.get(args.accountId)
    if (inFlight !== undefined) return inFlight

    const work = this.mint(args).finally(() => {
      this.minting.delete(args.accountId)
    })
    this.minting.set(args.accountId, work)

    return work
  }

  private async mint(args: {
    session: CloudSession
    accountId: AccountId
  }): Promise<MintedToken> {
    const client = cloudClientFor({
      session: args.session,
      ...(this.clientVersion === undefined ? {} : { clientVersion: this.clientVersion }),
      ...(this.fetchFn === undefined ? {} : { fetchFn: this.fetchFn }),
    })
    const rejected = this.rejected.get(args.accountId)

    try {
      const brokered = await client.accessToken({
        accountId: args.accountId,
        ...(rejected === undefined ? {} : { rejectedAccessToken: rejected }),
      })
      if (rejected !== undefined && brokered.accessToken !== rejected) {
        this.rejected.delete(args.accountId)
      }

      return this.hold({ accountId: args.accountId, brokered })
    } catch (error) {
      const stale = this.held.get(args.accountId)
      if (!isCloudUnavailable(error) || stale === undefined || this.nowMs() >= stale.usableUntilMs)
        throw error

      return stale
    }
  }

  private hold(args: { accountId: AccountId; brokered: BrokeredAccessToken }): MintedToken {
    const expiresAtMs = expiryMillisOf(args.brokered.expiresAt)
    const nowMs = this.nowMs()

    const minted: MintedToken = {
      accessToken: args.brokered.accessToken,
      expiresAt: args.brokered.expiresAt,
      freshUntilMs:
        expiresAtMs === null ? nowMs + DEFAULT_REFRESH_SKEW_MS : expiresAtMs - DEFAULT_REFRESH_SKEW_MS,
      usableUntilMs: expiresAtMs ?? Number.POSITIVE_INFINITY,
    }
    this.held.set(args.accountId, minted)

    return minted
  }

  private forgetTokensOfOtherSession(token: string): void {
    if (this.sessionToken === token) return
    this.sessionToken = token
    this.held.clear()
    this.rejected.clear()
  }

  private nowMs(): number {
    return Date.parse(this.clock.now())
  }

  private async chosenAccount(args: {
    provider: EAuthProvider
    accountId: AccountId | undefined
  }) {
    const preferred = args.accountId ?? (await this.accounts.activeFor(args.provider))
    const choice = chooseAccount({
      accounts: await this.accounts.list(),
      provider: args.provider,
      preferred,
    })
    if (choice.type === EAccountChoice.Refused) throw this.noAccount(args.provider, choice.reason)

    const stored = await this.accounts.read(choice.account.id)
    if (stored === undefined) throw this.noAccount(args.provider, ENoAccountReason.NoneForProvider)
    return stored
  }

  private noAccount(provider: EAuthProvider, reason: ENoAccountReason): CredentialError {
    return new CredentialError({
      failure: ECredentialFailure.NotFound,
      message: `no ${provider} account is available (${reason}). ${SIGN_IN}`,
    })
  }
}
