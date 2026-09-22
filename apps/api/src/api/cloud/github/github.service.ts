import { randomUUID } from 'node:crypto'
import {
  BadGatewayException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { EnvService } from '../../../_core/config/env/env.service'
import { db } from '../../../db'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import type { GithubPollOutcome } from './github-device-client'
import { GithubDeviceClient } from './github-device-client'
import type {
  GithubConnectionDto,
  GithubDeviceCodesDto,
  GithubPollResultDto,
  GithubTokenDto,
} from './github.types'
import { EGithubPollStatus } from './github.types'

function splitScopes(scope: string): string[] {
  return scope.split(/\s+/).filter((entry) => entry.length > 0)
}

function mapPollError(outcome: { error: string; description?: string }): GithubPollResultDto {
  if (outcome.error === 'authorization_pending') return { status: EGithubPollStatus.Pending }
  if (outcome.error === 'slow_down') return { status: EGithubPollStatus.SlowDown }
  if (outcome.error === 'access_denied') return { status: EGithubPollStatus.Denied }
  if (outcome.error === 'expired_token') return { status: EGithubPollStatus.Expired }
  throw new BadGatewayException(
    outcome.description ?? `github token poll failed with ${outcome.error}`,
  )
}

@Injectable()
export class GithubService {
  constructor(
    private readonly cipher: SecretCipherService,
    private readonly env: EnvService,
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
    const { login } = await this.client.verifyToken({ accessToken: outcome.accessToken })
    const sealedToken = this.cipher.encrypt(outcome.accessToken)
    await db.githubConnection.upsert({
      where: { userId: args.userId },
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
    const row = await db.githubConnection.findUnique({ where: { userId: args.userId } })
    if (row === null) return { connected: false }
    return {
      connected: true,
      login: row.login,
      scopes: splitScopes(row.scopes),
      connectedAt: row.createdAt.toISOString(),
    }
  }

  async readToken(args: { userId: string }): Promise<GithubTokenDto> {
    const token = await this.findToken(args)
    if (token === undefined) throw new NotFoundException('github is not connected')
    return { token }
  }

  async findToken(args: { userId: string }): Promise<string | undefined> {
    const row = await db.githubConnection.findUnique({ where: { userId: args.userId } })
    if (row === null) return undefined
    return this.cipher.decrypt(row.sealedToken)
  }

  async disconnect(args: { userId: string }): Promise<void> {
    await db.githubConnection.deleteMany({ where: { userId: args.userId } })
  }

  private clientId(): string {
    const clientId = this.env.get('GITHUB_CLIENT_ID')
    if (clientId === undefined || clientId.length === 0) {
      throw new ServiceUnavailableException('github connect is not configured')
    }
    return clientId
  }
}
