import { randomUUID } from 'node:crypto'
import { db } from '@dltech/atlas-db'
import { GithubConfig } from './github-config'
import type { GithubSecretCipher } from './github-ports'
import { EGithubHttpStatus, GithubHttpError } from './github-http-error'
import type { GithubPollOutcome } from './github-device-client'
import { GithubDeviceClient } from './github-device-client'
import { missingScopesOf, splitScopes } from './github-scopes'
import type {
  GithubConnectionDto,
  GithubDeviceCodesDto,
  GithubPollResultDto,
  GithubTokenDto,
} from './github.types'
import { EGithubPollStatus } from './github.types'

export interface GithubCredentials {
  token: string
  scopes: string
}

function mapPollError(outcome: { error: string; description?: string }): GithubPollResultDto {
  if (outcome.error === 'authorization_pending') return { status: EGithubPollStatus.Pending }
  if (outcome.error === 'slow_down') return { status: EGithubPollStatus.SlowDown }
  if (outcome.error === 'access_denied') return { status: EGithubPollStatus.Denied }
  if (outcome.error === 'expired_token') return { status: EGithubPollStatus.Expired }
  throw new GithubHttpError({
    status: EGithubHttpStatus.BadGateway,
    message: outcome.description ?? `github token poll failed with ${outcome.error}`,
  })
}

export class GithubService {
  constructor(
    private readonly cipher: GithubSecretCipher,
    private readonly config: GithubConfig,
    private readonly client: GithubDeviceClient,
  ) {}

  async beginConnect(): Promise<GithubDeviceCodesDto> {
    return this.client.beginDeviceFlow({ clientId: this.clientId() })
  }

  async pollConnect(args: { userId: string; deviceCode: string }): Promise<GithubPollResultDto> {
    const outcome: GithubPollOutcome = await this.client.pollDeviceToken({
      clientId: this.clientId(),
      deviceCode: args.deviceCode,
    })
    if (outcome.kind === 'error') return mapPollError(outcome)
    const missing = missingScopesOf(outcome.scope)
    if (missing.length > 0) {
      return { status: EGithubPollStatus.MissingScopes, missing }
    }
    const { login } = await this.client.verifyToken({ accessToken: outcome.accessToken })
    const sealedToken = this.cipher.encrypt(outcome.accessToken)
    await db.orm.public.GithubConnection.upsert({
      conflictOn: { userId: args.userId },
      create: {
        id: `gh_${randomUUID()}`,
        login,
        scopes: outcome.scope,
        sealedToken,
        userId: args.userId,
      },
      update: { login, scopes: outcome.scope, sealedToken },
    })
    return { status: EGithubPollStatus.Connected, login, scopes: splitScopes(outcome.scope) }
  }

  async read(args: { userId: string }): Promise<GithubConnectionDto> {
    const row = await db.orm.public.GithubConnection.first({ userId: args.userId })
    if (row === null) return { connected: false }
    return {
      connected: true,
      login: row.login,
      scopes: splitScopes(row.scopes),
      missingScopes: missingScopesOf(row.scopes),
      connectedAt: row.createdAt.toISOString(),
    }
  }

  async readToken(args: { userId: string }): Promise<GithubTokenDto> {
    const token = await this.findToken(args)
    if (token === undefined)
      throw new GithubHttpError({
        status: EGithubHttpStatus.NotFound,
        message: 'github is not connected',
      })
    return { token }
  }

  async findToken(args: { userId: string }): Promise<string | undefined> {
    const row = await db.orm.public.GithubConnection.first({ userId: args.userId })
    if (row === null) return undefined
    return this.cipher.decrypt(row.sealedToken)
  }

  async findCredentials(args: { userId: string }): Promise<GithubCredentials | undefined> {
    const row = await db.orm.public.GithubConnection.first({ userId: args.userId })
    if (row === null) return undefined
    return { token: this.cipher.decrypt(row.sealedToken), scopes: row.scopes }
  }

  async disconnect(args: { userId: string }): Promise<void> {
    await db.orm.public.GithubConnection.where({ userId: args.userId }).deleteAndCount()
  }

  private clientId(): string {
    const clientId = this.config.values.clientId
    if (clientId === undefined || clientId.length === 0) {
      throw new GithubHttpError({
        status: EGithubHttpStatus.ServiceUnavailable,
        message: 'github connect is not configured',
      })
    }
    return clientId
  }
}
