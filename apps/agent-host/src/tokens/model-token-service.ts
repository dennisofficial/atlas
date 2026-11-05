import { CredentialError, ECredentialFailure } from '../model/credential-error'
import type { SecretCipher } from '../config/secret-cipher'
import { refreshAnthropicGrant, type TokenFetch } from './anthropic-token-endpoint'
import type { OauthConnectionStore } from './oauth-connection-store'
import {
  STALE_ATTEMPT_MS,
  isDue,
  isUsable,
  newAttemptId,
  refreshAfterMs,
} from './oauth-refresh-policy'
import {
  EConnectionStatus,
  ProviderRateLimitedError,
  ProviderRejectedError,
  type ConnectionRow,
  type IssuedModelToken,
  type StoredTokens,
} from './oauth-types'

const MAX_PASSES = 6
const ANTHROPIC = 'anthropic'

const failure = (kind: ECredentialFailure, message: string, providerRefused?: boolean) =>
  new CredentialError({ failure: kind, message, providerRefused })

export class ModelTokenService {
  private readonly now: () => number

  constructor(
    private readonly args: {
      store: OauthConnectionStore
      cipher: SecretCipher
      now?: (() => number) | undefined
      fetchFn?: TokenFetch | undefined
    },
  ) {
    this.now = args.now ?? Date.now
  }

  async issue(args: {
    userId: string
    connectionId: string
    rejectedAccessToken?: string | undefined
  }): Promise<IssuedModelToken> {
    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
      const row = await this.args.store.find({ id: args.connectionId })
      if (row === null || row.userId !== args.userId) {
        throw failure(ECredentialFailure.NotFound, 'the model connection was not found')
      }
      if (row.status !== EConnectionStatus.Active) {
        throw failure(ECredentialFailure.Expired, 'the model connection needs a fresh login')
      }
      if (row.provider !== ANTHROPIC) {
        throw failure(ECredentialFailure.Unsupported, `provider ${row.provider} is not supported`)
      }
      const tokens = this.unseal(row.sealedTokens)
      const rejected = args.rejectedAccessToken === tokens.accessToken
      if (!rejected && !isDue({ tokens, nowMs: this.now() })) return this.issued({ tokens, row })
      if (row.refreshAttempt !== null) return this.whileAttemptLive({ row, tokens, rejected })
      const outcome = await this.refreshOnce({ row, tokens, rejected })
      if (outcome !== undefined) return outcome
    }
    throw failure(ECredentialFailure.RefreshFailed, 'the connection is busy; retry shortly')
  }

  private whileAttemptLive(args: {
    row: ConnectionRow
    tokens: StoredTokens
    rejected: boolean
  }): IssuedModelToken {
    const startedMs = args.row.refreshStartedAt?.getTime() ?? 0
    const stale = this.now() - startedMs > STALE_ATTEMPT_MS
    return this.cachedOrThrow({
      ...args,
      unavailable: stale
        ? failure(ECredentialFailure.Expired, 'a refresh attempt was abandoned; log in again')
        : failure(ECredentialFailure.RefreshFailed, 'a refresh is still in flight; retry shortly'),
    })
  }

  private async refreshOnce(args: {
    row: ConnectionRow
    tokens: StoredTokens
    rejected: boolean
  }): Promise<IssuedModelToken | undefined> {
    const attemptId = newAttemptId()
    const nowMs = this.now()
    const claimed = await this.args.store.claim({
      id: args.row.id,
      userId: args.row.userId,
      generation: args.row.generation,
      attemptId,
      startedAt: new Date(nowMs),
    })
    if (!claimed) return undefined
    const fence = { id: args.row.id, attemptId, generation: args.row.generation }
    try {
      const grant = await refreshAnthropicGrant({
        refreshToken: args.tokens.refreshToken,
        nowMs,
        fetchFn: this.args.fetchFn,
      })
      const next: StoredTokens = {
        ...args.tokens,
        ...grant,
        issuedAt: new Date(nowMs).toISOString(),
      }
      const stored = await this.args.store.complete({ ...fence, sealedTokens: this.seal(next) })
      if (!stored) return undefined
      return this.issued({ tokens: next, row: { generation: args.row.generation + 1 } })
    } catch (error) {
      if (await this.fenceLost(fence)) return undefined
      if (error instanceof ProviderRejectedError) {
        await this.args.store.reject(fence)
        throw failure(ECredentialFailure.Expired, 'the provider rejected the grant', true)
      }
      if (error instanceof ProviderRateLimitedError) await this.args.store.release(fence)
      return this.cachedOrThrow({
        ...args,
        unavailable: failure(ECredentialFailure.RefreshFailed, 'the token issuer is unavailable'),
      })
    }
  }

  private async fenceLost(fence: { id: string; attemptId: string }): Promise<boolean> {
    const latest = await this.args.store.find({ id: fence.id })
    return latest === null || latest.refreshAttempt !== fence.attemptId
  }

  private cachedOrThrow(args: {
    row: Pick<ConnectionRow, 'generation'>
    tokens: StoredTokens
    rejected: boolean
    unavailable: Error
  }): IssuedModelToken {
    if (args.rejected || !isUsable({ tokens: args.tokens, nowMs: this.now() })) {
      throw args.unavailable
    }
    return this.issued(args)
  }

  private issued(args: {
    tokens: StoredTokens
    row: Pick<ConnectionRow, 'generation'>
  }): IssuedModelToken {
    return {
      accessToken: args.tokens.accessToken,
      expiresAt: args.tokens.expiresAt,
      refreshAfter: new Date(refreshAfterMs(args.tokens)).toISOString(),
      generation: args.row.generation,
    }
  }

  private seal(tokens: StoredTokens): string {
    return this.args.cipher.encrypt(JSON.stringify(tokens))
  }

  private unseal(sealed: string): StoredTokens {
    return JSON.parse(this.args.cipher.decrypt(sealed)) as StoredTokens
  }
}
