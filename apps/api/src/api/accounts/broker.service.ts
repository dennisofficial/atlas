import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { db } from '../../db'
import { SecretCipherService } from '../../_lib/crypto/secret-cipher.service'
import { OAuthRefreshError, refreshOauthTokens } from '../../_lib/oauth-refresh'
import type { AccessTokenDto, AccountSecret } from './accounts.types'
import { EAccountStatus, EAuthKind } from './accounts.types'

const REFRESH_SKEW_MS = 5 * 60 * 1000
const MAX_ROTATION_ATTEMPTS = 2

@Injectable()
export class BrokerService {
  constructor(private readonly cipher: SecretCipherService) {}

  async accessToken(args: { userId: string; accountId: string }): Promise<AccessTokenDto> {
    for (let attempt = 0; attempt < MAX_ROTATION_ATTEMPTS; attempt++) {
      const row = await db.agentAccount.findFirst({
        where: { id: args.accountId, userId: args.userId },
      })
      if (row === null) throw new NotFoundException('account not found')

      const secret = JSON.parse(this.cipher.decrypt(row.sealedSecret)) as AccountSecret
      if (secret.kind === EAuthKind.ApiKey) {
        return { accessToken: secret.apiKey, expiresAt: null }
      }

      const tokens = secret.tokens
      const remainingMs = Date.parse(tokens.expiresAt) - Date.now()
      if (remainingMs > REFRESH_SKEW_MS) {
        return { accessToken: tokens.accessToken, expiresAt: tokens.expiresAt }
      }
      if (tokens.refreshToken.length === 0) {
        throw new BadRequestException(
          'this account holds no refresh token — sign the account in again',
        )
      }

      const rotated = await this.refresh({ provider: row.provider, tokens })
      const next: AccountSecret = {
        kind: EAuthKind.Oauth,
        tokens: { ...tokens, ...rotated },
      }

      const { count } = await db.agentAccount.updateMany({
        where: { id: row.id, secretVersion: row.secretVersion },
        data: {
          sealedSecret: this.cipher.encrypt(JSON.stringify(next)),
          kind: EAuthKind.Oauth,
          status: EAccountStatus.Active,
          secretVersion: row.secretVersion + 1,
        },
      })
      if (count === 1) return { accessToken: rotated.accessToken, expiresAt: rotated.expiresAt }

      // A concurrent request rotated first and owns the row now; the next pass
      // re-reads and returns the winner's fresh token without re-calling the provider.
    }

    throw new ConflictException('the credential rotated under us twice — retry the request')
  }

  private async refresh(args: {
    provider: string
    tokens: { refreshToken: string }
  }): ReturnType<typeof refreshOauthTokens> {
    try {
      return await refreshOauthTokens({
        provider: args.provider,
        refreshToken: args.tokens.refreshToken,
      })
    } catch (error) {
      if (error instanceof OAuthRefreshError) throw error
      throw new OAuthRefreshError({
        provider: args.provider,
        status: 0,
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
