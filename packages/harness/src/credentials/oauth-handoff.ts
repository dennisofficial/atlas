import {
  authorityOf,
  EAccountOrigin,
  EAuthKind,
  EAuthProvider,
  providerSpec,
  type AccountId,
  type AccountStorePort,
  type ClockPort,
  type StoredAccount,
} from '@dltech/atlas-core'
import { randomUUID } from 'node:crypto'

import type { CloudSession } from '../cloud/cloud-session'
import type {
  OAuthConnectionsClient,
  OauthConnectionProvider,
} from '../cloud/oauth-connections-client'
import { CredentialError, ECredentialFailure } from './credential-error'
import { isPending, persistAccess, sameUrl, underAccountLock } from './oauth-owned-secret'

const LEGACY_CLI_SOURCES: readonly string[] = ['claude-code', 'codex']

const wireProviderOf: Partial<Record<EAuthProvider, OauthConnectionProvider>> = {
  [EAuthProvider.Anthropic]: 'anthropic',
  [EAuthProvider.OpenAI]: 'openai',
}

const failure = (args: { failure: ECredentialFailure; message: string }): CredentialError =>
  new CredentialError(args)

const isLegacyCliImport = (stored: StoredAccount): boolean =>
  stored.origin === EAccountOrigin.Imported &&
  stored.importedFrom !== undefined &&
  LEGACY_CLI_SOURCES.includes(stored.importedFrom)

export class OauthHandoff {
  private readonly accounts: AccountStorePort
  private readonly clock: ClockPort
  private readonly clients: (session: CloudSession) => OAuthConnectionsClient
  private readonly newConnectionId: () => string
  private readonly inFlight = new Map<AccountId, Promise<StoredAccount>>()

  constructor(args: {
    accounts: AccountStorePort
    clock: ClockPort
    clients: (session: CloudSession) => OAuthConnectionsClient
    newConnectionId?: (() => string) | undefined
  }) {
    this.accounts = args.accounts
    this.clock = args.clock
    this.clients = args.clients
    this.newConnectionId = args.newConnectionId ?? (() => `oauth_${randomUUID()}`)
  }

  transfer(args: {
    accountId: AccountId
    session: CloudSession
    alreadyLocked?: boolean | undefined
  }): Promise<StoredAccount> {
    if (args.alreadyLocked === true) return this.run(args)

    const running = this.inFlight.get(args.accountId)
    if (running !== undefined) return running

    const work = this.run(args).finally(() => {
      this.inFlight.delete(args.accountId)
    })
    this.inFlight.set(args.accountId, work)

    return work
  }

  private async run(args: {
    accountId: AccountId
    session: CloudSession
    alreadyLocked?: boolean | undefined
  }): Promise<StoredAccount> {
    const fenced = await this.fence(args)
    const authority = authorityOf(fenced.secret)
    if (fenced.secret.kind !== EAuthKind.Oauth || authority === undefined || !isPending(fenced))
      return fenced

    const provider = wireProviderOf[fenced.provider]
    if (provider === undefined) throw this.unsupported(fenced)

    const client = this.clients(args.session)
    const access =
      authority.previousAuthorizationId === undefined
        ? await client.handoff({
            connectionId: authority.connectionId,
            provider,
            tokens: fenced.secret.tokens,
          })
        : await client.reauthorize({
            connectionId: authority.connectionId,
            provider,
            tokens: fenced.secret.tokens,
            authorizationId: authority.authorizationId ?? authority.connectionId,
            previousAuthorizationId: authority.previousAuthorizationId,
          })
    const persisted = await persistAccess({
      accounts: this.accounts,
      accountId: args.accountId,
      connectionId: authority.connectionId,
      authorizationId: authority.authorizationId,
      settlesPending: true,
      alreadyLocked: args.alreadyLocked,
      access,
      nowMs: () => Date.parse(this.clock.now()),
    })
    if (persisted === undefined) {
      throw failure({
        failure: ECredentialFailure.StoreUnavailable,
        message: `The ${fenced.label} login changed while it was being transferred to Atlas Cloud. Retry.`,
      })
    }

    return persisted
  }

  fence(args: {
    accountId: AccountId
    session: CloudSession
    alreadyLocked?: boolean | undefined
  }): Promise<StoredAccount> {
    return underAccountLock({
      accounts: this.accounts,
      accountId: args.accountId,
      alreadyLocked: args.alreadyLocked,
      run: async () => {
        const current = await this.accounts.read(args.accountId)
        if (current === undefined) {
          throw failure({
            failure: ECredentialFailure.NotFound,
            message: 'That account no longer exists, so it cannot be transferred to Atlas Cloud.',
          })
        }
        if (current.secret.kind !== EAuthKind.Oauth) return current

        const authority = authorityOf(current.secret)
        if (authority !== undefined) {
          if (!sameUrl(authority.url, args.session.url)) throw this.otherAuthority(current)
          return current
        }
        if (isLegacyCliImport(current)) throw this.legacyImport(current)
        if (wireProviderOf[current.provider] === undefined) throw this.unsupported(current)
        if (current.secret.tokens.refreshToken.length === 0) {
          throw failure({
            failure: ECredentialFailure.Expired,
            message: `The ${current.label} login has no renewable grant to transfer. Sign in again with /auth, or re-lift the session from the machine that owns its login.`,
          })
        }

        const secret = {
          ...current.secret,
          authority: { url: args.session.url, connectionId: this.newConnectionId() },
        }
        await this.accounts.replaceSecret({ accountId: current.id, secret })

        return { ...current, secret }
      },
    })
  }

  private legacyImport(stored: StoredAccount): CredentialError {
    return failure({
      failure: ECredentialFailure.Expired,
      message: `The ${providerSpec(stored.provider).label} login for ${stored.label} was imported from another tool's CLI and cannot be managed by Atlas Cloud. Sign in again with /auth.`,
    })
  }

  private otherAuthority(stored: StoredAccount): CredentialError {
    return failure({
      failure: ECredentialFailure.Unsupported,
      message: `The ${stored.label} login belongs to a different Atlas Cloud API than the one you are signed in to. Sign in to that API, or sign in to ${providerSpec(stored.provider).label} again with /auth.`,
    })
  }

  private unsupported(stored: StoredAccount): CredentialError {
    return failure({
      failure: ECredentialFailure.Unsupported,
      message: `Atlas Cloud cannot manage ${providerSpec(stored.provider).label} OAuth logins.`,
    })
  }
}
