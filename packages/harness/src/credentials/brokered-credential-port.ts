import {
  chooseAccount,
  CredentialPort,
  EAccountChoice,
  EAuthKind,
  EAuthProvider,
  ENoAccountReason,
  type AccountId,
  type AccountStorePort,
  type Credential,
  type CredentialRequest,
} from '@dltech/atlas-core'

import { cloudClientFor } from '../cloud/cloud-client'
import type { CloudSessionStore } from '../cloud/cloud-session'
import { CredentialError, ECredentialFailure } from './credential-error'

const SIGN_IN = 'Sign in with /auth.'

/**
 * Credentials come from the cloud broker, which is the only refresher: a read returns the
 * account's usable access token, and the API rotates the OAuth pair itself when the token
 * nears expiry. Nothing here refreshes locally — two clients refreshing the same account
 * race and invalidate each other, which is the whole reason the broker exists.
 */
export class BrokeredCredentialPort extends CredentialPort {
  private readonly accounts: AccountStorePort
  private readonly sessions: CloudSessionStore
  private readonly clientVersion: string | undefined
  private readonly rejected = new Map<AccountId, string>()
  private readonly defaultProvider: EAuthProvider
  private readonly fetchFn: typeof fetch | undefined

  constructor(args: {
    accounts: AccountStorePort
    sessions: CloudSessionStore
    clientVersion?: string
    defaultProvider?: EAuthProvider
    fetchFn?: typeof fetch
  }) {
    super()
    this.accounts = args.accounts
    this.sessions = args.sessions
    this.clientVersion = args.clientVersion
    this.defaultProvider = args.defaultProvider ?? EAuthProvider.Anthropic
    this.fetchFn = args.fetchFn
  }

  async read(request?: CredentialRequest): Promise<Credential> {
    const provider = request?.provider ?? this.defaultProvider
    const stored = await this.chosenAccount({ provider, accountId: request?.accountId })

    const session = this.sessions.read()
    if (session === null) throw this.noAccount(provider, ENoAccountReason.NoneForProvider)

    const client = cloudClientFor({
      session,
      ...(this.clientVersion === undefined ? {} : { clientVersion: this.clientVersion }),
      ...(this.fetchFn === undefined ? {} : { fetchFn: this.fetchFn }),
    })
    const rejected = this.rejected.get(stored.id)
    const brokered = await client.accessToken({
      accountId: stored.id,
      ...(rejected === undefined ? {} : { rejectedAccessToken: rejected }),
    })
    if (rejected !== undefined && brokered.accessToken !== rejected) {
      this.rejected.delete(stored.id)
    }

    if (stored.secret.kind === EAuthKind.ApiKey) {
      return { kind: EAuthKind.ApiKey, accountId: stored.id, apiKey: brokered.accessToken }
    }
    return {
      kind: EAuthKind.Oauth,
      accountId: stored.id,
      accessToken: brokered.accessToken,
      expiresAt: brokered.expiresAt ?? stored.secret.tokens.expiresAt,
      providerAccountId: stored.secret.tokens.accountId,
    }
  }

  async discard(credential: Credential): Promise<void> {
    if (credential.kind !== EAuthKind.Oauth) return
    this.rejected.set(credential.accountId, credential.accessToken)
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
