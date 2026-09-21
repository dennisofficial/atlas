import {
  CredentialPort,
  DEFAULT_REFRESH_SKEW_MS,
  EAuthKind,
  EAuthProvider,
  type AccountId,
  type ClockPort,
  type Credential,
  type CredentialRequest,
} from '@dltech/atlas-core'

import { isCloudUnavailable } from '../cloud/cloud-transport'

import type { ServeBrokerClient, ServeBrokeredToken } from './serve-broker-client'

type MintedToken = {
  accountId: AccountId
  kind: EAuthKind
  accessToken: string
  expiresAt: string | null
  providerAccountId: string | undefined
  freshUntilMs: number
  usableUntilMs: number
}

const expiryMillisOf = (expiresAt: string | null): number | null => {
  if (expiresAt === null) return null
  const parsed = Date.parse(expiresAt)
  return Number.isNaN(parsed) ? null : parsed
}

const credentialOf = (minted: MintedToken): Credential => {
  if (minted.kind === EAuthKind.ApiKey) {
    return { kind: EAuthKind.ApiKey, accountId: minted.accountId, apiKey: minted.accessToken }
  }
  return {
    kind: EAuthKind.Oauth,
    accountId: minted.accountId,
    accessToken: minted.accessToken,
    expiresAt: minted.expiresAt ?? '',
    ...(minted.providerAccountId === undefined ? {} : { providerAccountId: minted.providerAccountId }),
  }
}

/**
 * The sandbox-side credential port: minting rides the thread-scoped broker, which resolves the
 * account (the requested one, else the owner's active account for the provider) and rotates the
 * OAuth pair server-side. The caching contract mirrors BrokeredCredentialPort — a minted token is
 * held until it nears expiry, a discarded one is sent back as rejected so the broker rotates
 * instead of re-issuing it, and a short API outage falls back to a held token that is still
 * usable — but no account list or sealed secret ever crosses onto the sandbox.
 */
export class ServeCredentialPort extends CredentialPort {
  private readonly broker: ServeBrokerClient
  private readonly clock: ClockPort
  private readonly defaultProvider: EAuthProvider
  private readonly held = new Map<AccountId, MintedToken>()
  private readonly resolved = new Map<EAuthProvider, AccountId>()
  private readonly rejected = new Map<AccountId, string>()
  private readonly minting = new Map<string, Promise<MintedToken>>()

  constructor(args: {
    broker: ServeBrokerClient
    clock: ClockPort
    defaultProvider?: EAuthProvider
  }) {
    super()
    this.broker = args.broker
    this.clock = args.clock
    this.defaultProvider = args.defaultProvider ?? EAuthProvider.Anthropic
  }

  async read(request?: CredentialRequest): Promise<Credential> {
    const provider = request?.provider ?? this.defaultProvider
    const knownAccountId = request?.accountId ?? this.resolved.get(provider)

    if (knownAccountId !== undefined) {
      const held = this.held.get(knownAccountId)
      if (held !== undefined && this.nowMs() < held.freshUntilMs) return credentialOf(held)
    }

    const minted = await this.mint({ provider, accountId: request?.accountId })
    return credentialOf(minted)
  }

  async discard(credential: Credential): Promise<void> {
    this.held.delete(credential.accountId)
    if (credential.kind !== EAuthKind.Oauth) return
    this.rejected.set(credential.accountId, credential.accessToken)
  }

  private mint(args: {
    provider: EAuthProvider
    accountId: AccountId | undefined
  }): Promise<MintedToken> {
    const key = args.accountId ?? args.provider
    const inFlight = this.minting.get(key)
    if (inFlight !== undefined) return inFlight

    const work = this.mintFresh(args).finally(() => {
      this.minting.delete(key)
    })
    this.minting.set(key, work)
    return work
  }

  private async mintFresh(args: {
    provider: EAuthProvider
    accountId: AccountId | undefined
  }): Promise<MintedToken> {
    const knownAccountId = args.accountId ?? this.resolved.get(args.provider)
    const rejected =
      knownAccountId === undefined ? undefined : this.rejected.get(knownAccountId)

    try {
      const brokered = await this.broker.accessToken({
        provider: args.provider,
        ...(args.accountId === undefined ? {} : { accountId: args.accountId }),
        ...(rejected === undefined ? {} : { rejectedAccessToken: rejected }),
      })
      if (rejected !== undefined && brokered.accessToken !== rejected) {
        this.rejected.delete(brokered.accountId)
      }
      this.resolved.set(args.provider, brokered.accountId)
      return this.hold(brokered)
    } catch (error) {
      const stale = knownAccountId === undefined ? undefined : this.held.get(knownAccountId)
      if (!isCloudUnavailable(error) || stale === undefined || this.nowMs() >= stale.usableUntilMs) {
        throw error
      }
      return stale
    }
  }

  private hold(brokered: ServeBrokeredToken): MintedToken {
    const expiresAtMs = expiryMillisOf(brokered.expiresAt)
    const nowMs = this.nowMs()

    const minted: MintedToken = {
      accountId: brokered.accountId,
      kind: brokered.kind,
      accessToken: brokered.accessToken,
      expiresAt: brokered.expiresAt,
      providerAccountId: brokered.providerAccountId,
      freshUntilMs:
        expiresAtMs === null ? nowMs + DEFAULT_REFRESH_SKEW_MS : expiresAtMs - DEFAULT_REFRESH_SKEW_MS,
      usableUntilMs: expiresAtMs ?? Number.POSITIVE_INFINITY,
    }
    this.held.set(brokered.accountId, minted)
    return minted
  }

  private nowMs(): number {
    return Date.parse(this.clock.now())
  }
}
