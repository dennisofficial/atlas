import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import type { ReauthorizeConnectionDto, UploadConnectionDto } from './oauth-connections.dto'
import {
  EConnectionStatus,
  EOauthProvider,
  OauthClock,
  OauthConnectionStore,
  OauthIssuer,
  OauthRateLimitedError,
  OauthRejectedError,
} from './oauth-connections.types'
import type { AccessTokenDto, ConnectionRow, StoredTokens } from './oauth-connections.types'
import {
  STALE_ATTEMPT_MS,
  WAIT_BUDGET_MS,
  WAIT_POLL_MS,
  isDue,
  isUsable,
  newAttemptId,
  refreshAfterMs,
} from './oauth-refresh-policy'

const MAX_PASSES = 6

const reauthorizationRequired = (): ConflictException =>
  new ConflictException('this connection needs a fresh login before it can issue tokens')

@Injectable()
export class OauthConnectionsService {
  constructor(
    private readonly store: OauthConnectionStore,
    private readonly cipher: SecretCipherService,
    private readonly issuer: OauthIssuer,
    private readonly clock: OauthClock,
  ) {}

  async upload(args: {
    userId: string
    connectionId: string
    draft: UploadConnectionDto
  }): Promise<AccessTokenDto> {
    const issuedAt = new Date(this.clock.now()).toISOString()
    const tokens: StoredTokens = { ...args.draft.tokens, issuedAt }
    const inserted = await this.store.insert({
      id: args.connectionId,
      userId: args.userId,
      provider: args.draft.provider,
      sealedTokens: this.seal(tokens),
    })
    if (inserted) return this.toDto({ tokens, row: { generation: 0, authorizationId: args.connectionId } })
    return this.issueAccessToken({ userId: args.userId, connectionId: args.connectionId })
  }

  async metadata(args: { userId: string; connectionId: string }): Promise<{
    provider: string; authorizationId: string; generation: number
  }> {
    const row = await this.authorizedRow(args)
    return { provider: row.provider, authorizationId: row.authorizationId, generation: row.generation }
  }

  async reauthorize(args: {
    userId: string
    connectionId: string
    draft: ReauthorizeConnectionDto
  }): Promise<AccessTokenDto> {
    const { draft, userId, connectionId } = args
    const row = await this.authorizedRow({ userId, connectionId })
    if (row.provider !== draft.provider) {
      throw new ConflictException('the connection belongs to another provider')
    }
    const current = () => this.issueAccessToken({ userId, connectionId })
    if (row.authorizationId === draft.authorizationId) return current()

    const tokens: StoredTokens = { ...draft.tokens, issuedAt: new Date(this.clock.now()).toISOString() }
    const replaced = await this.store.reauthorize({
      id: connectionId,
      userId,
      authorizationId: draft.authorizationId,
      previousAuthorizationId: draft.previousAuthorizationId,
      sealedTokens: this.seal(tokens),
    })
    if (replaced) return current()

    const latest = await this.authorizedRow({ userId, connectionId })
    if (latest.authorizationId === draft.authorizationId) return current()
    throw new ConflictException('the connection was reauthorized from a different login')
  }

  async issueAccessToken(args: {
    userId: string
    connectionId: string
    sandboxId?: string
    rejectedAccessToken?: string
  }): Promise<AccessTokenDto> {
    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
      const row = await this.authorizedRow(args)
      if (row.status !== EConnectionStatus.Active) throw reauthorizationRequired()
      const tokens = this.unseal(row.sealedTokens)
      const rejected = args.rejectedAccessToken === tokens.accessToken
      if (!rejected && !isDue({ tokens, nowMs: this.clock.now() })) {
        return this.toDto({ tokens, row })
      }
      if (row.refreshAttempt !== null) {
        const outcome = await this.awaitAttempt({ row, tokens, rejected })
        if (outcome !== undefined) return outcome
        continue
      }
      const attempted = await this.refreshOnce({ row, tokens, rejected })
      if (attempted !== undefined) return attempted
    }
    throw new ServiceUnavailableException('the connection is busy; retry shortly')
  }

  async assignSandbox(args: {
    userId: string
    connectionId: string
    threadId: string
  }): Promise<void> {
    await this.authorizedRow(args)
    const sandboxId = await this.store.ownedSandboxId(args)
    if (sandboxId === null) throw new NotFoundException('sandbox not found')
    await this.store.assign({ connectionId: args.connectionId, sandboxId })
  }

  async remove(args: { userId: string; connectionId: string }): Promise<void> {
    const removed = await this.store.remove({ id: args.connectionId, userId: args.userId })
    if (!removed) throw new NotFoundException('connection not found')
  }

  private async authorizedRow(args: {
    userId: string
    connectionId: string
    sandboxId?: string
  }): Promise<ConnectionRow> {
    const row = await this.store.find({ id: args.connectionId })
    if (row === null || row.userId !== args.userId) throw new NotFoundException('connection not found')
    if (args.sandboxId === undefined) return row
    const assigned = await this.store.isAssigned({
      connectionId: args.connectionId,
      sandboxId: args.sandboxId,
    })
    if (!assigned) throw new NotFoundException('connection not found')
    return row
  }

  private async awaitAttempt(args: {
    row: ConnectionRow
    tokens: StoredTokens
    rejected: boolean
  }): Promise<AccessTokenDto | undefined> {
    const startedMs = args.row.refreshStartedAt?.getTime() ?? 0
    if (this.clock.now() - startedMs > STALE_ATTEMPT_MS) {
      return this.cachedOrThrow({ ...args, unavailable: reauthorizationRequired() })
    }
    const deadline = this.clock.now() + WAIT_BUDGET_MS
    while (this.clock.now() < deadline) {
      await this.clock.sleep(WAIT_POLL_MS)
      const current = await this.store.find({ id: args.row.id })
      if (current === null || current.refreshAttempt !== args.row.refreshAttempt) return undefined
    }
    return this.cachedOrThrow({
      ...args,
      unavailable: new ServiceUnavailableException('a refresh is still in flight; retry shortly'),
    })
  }

  private async refreshOnce(args: {
    row: ConnectionRow
    tokens: StoredTokens
    rejected: boolean
  }): Promise<AccessTokenDto | undefined> {
    const attemptId = newAttemptId()
    const nowMs = this.clock.now()
    const claimed = await this.store.claim({
      id: args.row.id,
      userId: args.row.userId,
      generation: args.row.generation,
      attemptId,
      startedAt: new Date(nowMs),
    })
    if (!claimed) return undefined
    const fence = { id: args.row.id, attemptId, generation: args.row.generation }
    const unavailable = new ServiceUnavailableException('the token issuer is unavailable; retry shortly')

    try {
      const issued = await this.issuer.refresh({
        provider: args.row.provider as EOauthProvider,
        refreshToken: args.tokens.refreshToken,
        nowMs,
      })
      const next: StoredTokens = {
        ...args.tokens,
        ...issued,
        refreshToken: issued.refreshToken ?? args.tokens.refreshToken,
        issuedAt: new Date(nowMs).toISOString(),
      }
      const stored = await this.store.complete({ ...fence, sealedTokens: this.seal(next) })
      if (!stored) return undefined
      return this.toDto({ tokens: next, row: { ...args.row, generation: args.row.generation + 1 } })
    } catch (error) {
      if (await this.fenceLost(fence)) return undefined
      if (error instanceof OauthRejectedError) {
        await this.store.reject(fence)
        throw reauthorizationRequired()
      }
      if (error instanceof OauthRateLimitedError) await this.store.release(fence)
      return this.cachedOrThrow({ ...args, unavailable })
    }
  }

  private async fenceLost(fence: { id: string; attemptId: string }): Promise<boolean> {
    const latest = await this.store.find({ id: fence.id })
    return latest === null || latest.refreshAttempt !== fence.attemptId
  }

  private cachedOrThrow(args: {
    tokens: StoredTokens
    rejected: boolean
    unavailable: Error
    row: ConnectionRow
  }): AccessTokenDto {
    if (args.rejected || !isUsable({ tokens: args.tokens, nowMs: this.clock.now() })) {
      throw args.unavailable
    }
    return this.toDto({ tokens: args.tokens, row: args.row })
  }

  private seal(tokens: StoredTokens): string {
    return this.cipher.encrypt(JSON.stringify(tokens))
  }

  private unseal(sealed: string): StoredTokens {
    return JSON.parse(this.cipher.decrypt(sealed)) as StoredTokens
  }

  private toDto(args: {
    tokens: StoredTokens
    row: Pick<ConnectionRow, 'generation' | 'authorizationId'>
  }): AccessTokenDto {
    return {
      accessToken: args.tokens.accessToken,
      expiresAt: args.tokens.expiresAt,
      refreshAfter: new Date(refreshAfterMs(args.tokens)).toISOString(),
      generation: args.row.generation,
      authorizationId: args.row.authorizationId,
      ...(args.tokens.accountId === undefined ? {} : { providerAccountId: args.tokens.accountId }),
    }
  }
}
