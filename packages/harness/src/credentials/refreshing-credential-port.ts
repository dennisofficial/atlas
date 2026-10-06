import {
  chooseAccount,
  CredentialPort,
  EAccountChoice,
  EAccountStatus,
  EAuthKind,
  EAuthProvider,
  ENoAccountReason,
  ERefresh,
  isExpired,
  isSamePair,
  providerSpec,
  refreshDecision,
  type AccountId,
  type AccountStorePort,
  type ClockPort,
  type Credential,
  type CredentialRequest,
  type OauthTokens,
  type StoredAccount,
} from '@dltech/atlas-core'

import { CredentialError, ECredentialFailure } from './credential-error'
import { clientFor, isHardAuthFailure, type RefreshClients } from './oauth'

const SIGN_IN = 'Sign in with /auth.'

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

const tokensOf = (stored: StoredAccount): OauthTokens | undefined =>
  stored.secret.kind === EAuthKind.Oauth ? stored.secret.tokens : undefined

export class RefreshingCredentialPort extends CredentialPort {
  private readonly accounts: AccountStorePort
  private readonly clients: RefreshClients
  private readonly clock: ClockPort
  private readonly defaultProvider: EAuthProvider
  private readonly skewMs: number | undefined
  private readonly refreshing = new Map<AccountId, Promise<StoredAccount>>()
  private readonly rejected = new Map<AccountId, string>()

  constructor(args: {
    accounts: AccountStorePort
    clients: RefreshClients
    clock: ClockPort
    defaultProvider?: EAuthProvider
    skewMs?: number | undefined
  }) {
    super()
    this.accounts = args.accounts
    this.clients = args.clients
    this.clock = args.clock
    this.defaultProvider = args.defaultProvider ?? EAuthProvider.Anthropic
    this.skewMs = args.skewMs
  }

  async read(request?: CredentialRequest): Promise<Credential> {
    const provider = request?.provider ?? this.defaultProvider
    const stored = await this.chosenAccount({ provider, accountId: request?.accountId })

    const decision = this.decisionFor(stored)

    if (decision === ERefresh.Fresh) return credentialOf(stored)
    if (decision === ERefresh.Unrefreshable) throw this.expired(stored)

    return credentialOf(await this.sharedRefresh(stored))
  }

  async discard(credential: Credential): Promise<void> {
    if (credential.kind !== EAuthKind.Oauth) return
    this.rejected.set(credential.accountId, credential.accessToken)
  }

  private decisionFor(stored: StoredAccount): ERefresh {
    const held = tokensOf(stored)
    const revoked = held !== undefined && this.rejected.get(stored.id) === held.accessToken

    return refreshDecision({
      secret: stored.secret,
      now: this.clock.now(),
      revoked,
      ...(this.skewMs === undefined ? {} : { skewMs: this.skewMs }),
    })
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

    if (choice.type === EAccountChoice.Refused) throw this.noAccount(args.provider, choice.reason)

    const stored = await this.accounts.read(choice.account.id)
    if (stored === undefined) throw this.noAccount(args.provider, ENoAccountReason.NoneForProvider)

    return stored
  }

  private sharedRefresh(stored: StoredAccount): Promise<StoredAccount> {
    const inFlight = this.refreshing.get(stored.id)
    if (inFlight !== undefined) return inFlight

    const work = this.accounts.withAccountLock({
      accountId: stored.id,
      run: async () => {
        const current = await this.accounts.read(stored.id)
        if (current === undefined) throw this.noAccount(stored.provider, ENoAccountReason.NoneForProvider)
        const decision = this.decisionFor(current)
        if (decision === ERefresh.Fresh) return current
        if (decision === ERefresh.Unrefreshable) throw this.expired(current)
        return this.refresh(current)
      },
    }).finally(() => {
      this.refreshing.delete(stored.id)
    })
    this.refreshing.set(stored.id, work)

    return work
  }

  private async refresh(stored: StoredAccount): Promise<StoredAccount> {
    const tokens = tokensOf(stored)
    if (tokens === undefined) return stored

    const client = clientFor({ clients: this.clients, provider: stored.provider })

    try {
      const rotated = await client.refresh({ refreshToken: tokens.refreshToken })
      // Identity the provider only hands out at login (OpenAI's account id) survives rotation by
      // keeping whatever the refresh response did not replace.
      const merged = { ...tokens, ...rotated }
      const secret = { kind: EAuthKind.Oauth, tokens: merged } as const

      await this.accounts.replaceSecret({ accountId: stored.id, secret })
      const next: StoredAccount = { ...stored, secret, status: EAccountStatus.Active }
      this.rejected.delete(stored.id)

      return next
    } catch (error) {
      if (isHardAuthFailure(error)) return this.afterRefusal(stored)
      if (isExpired({ secret: stored.secret, now: this.clock.now() })) throw this.unreachable(error)

      return stored
    }
  }

  /**
   * A refused refresh means the token was already spent, which is exactly what another Atlas
   * sharing this vault looks like — it rotated, and the pair it left behind is live. Retiring the
   * account over a race we lost is how one bad refresh used to cost a working login.
   */
  private async afterRefusal(stored: StoredAccount): Promise<StoredAccount> {
    const rotatedElsewhere = await this.pairAnotherHolderLeft(stored)
    if (rotatedElsewhere === undefined) return this.retire(stored)

    this.rejected.delete(stored.id)

    return rotatedElsewhere
  }

  private async pairAnotherHolderLeft(stored: StoredAccount): Promise<StoredAccount | undefined> {
    const spent = tokensOf(stored)
    if (spent === undefined) return undefined

    const current = await this.accounts.read(stored.id)
    if (current === undefined) return undefined

    const now = tokensOf(current)
    if (now === undefined || isSamePair(now, spent)) return undefined

    return current
  }

  private async retire(stored: StoredAccount): Promise<never> {
    await this.accounts.setStatus({ accountId: stored.id, status: EAccountStatus.Expired })
    throw this.expired(stored)
  }

  private expired(stored: StoredAccount): CredentialError {
    return new CredentialError({
      failure: ECredentialFailure.Expired,
      message: `The ${providerSpec(stored.provider).label} login for ${stored.label} has expired and could not be refreshed. ${SIGN_IN}`,
    })
  }

  private unreachable(error: unknown): CredentialError {
    return new CredentialError({
      failure: ECredentialFailure.RefreshFailed,
      message: `The credential expired and the token endpoint could not be reached to refresh it: ${error instanceof Error ? error.message : 'the request failed'}.`,
    })
  }

  private noAccount(provider: EAuthProvider, reason: ENoAccountReason): CredentialError {
    const label = providerSpec(provider).label
    const detail =
      reason === ENoAccountReason.NoneAtAll
        ? 'Atlas holds no accounts.'
        : `Atlas holds no ${label} account.`

    return new CredentialError({ failure: ECredentialFailure.NotFound, message: `${detail} ${SIGN_IN}` })
  }
}
