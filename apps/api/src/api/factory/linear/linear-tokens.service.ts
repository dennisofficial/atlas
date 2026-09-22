import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import { EnvService } from '../../../_core/config/env/env.service'
import { mintClientCredentialsToken } from './linear-oauth'

const CLIENT_CREDENTIALS_SCOPE = 'read,write'
const EXPIRY_MARGIN_MS = 60_000

interface CachedToken {
  token: string
  expiresAt: number
}

@Injectable()
export class LinearTokensService {
  private cached: CachedToken | null = null

  constructor(private readonly env: EnvService) {}

  async getToken(): Promise<string> {
    if (this.cached !== null && this.cached.expiresAt > Date.now()) {
      return this.cached.token
    }
    return this.mint()
  }

  // Client-credentials tokens pair with no refresh token; a 401 from the Linear API means
  // drop the cache and mint again. https://linear.app/developers/oauth-2-0-authentication#client-credentials-tokens
  invalidate(): void {
    this.cached = null
  }

  private async mint(): Promise<string> {
    const clientId = this.env.get('LINEAR_CLIENT_ID')
    const clientSecret = this.env.get('LINEAR_CLIENT_SECRET')
    if (clientId === undefined || clientSecret === undefined) {
      throw new ServiceUnavailableException('the linear oauth app is not configured yet')
    }

    const minted = await mintClientCredentialsToken({
      clientId,
      clientSecret,
      scope: CLIENT_CREDENTIALS_SCOPE,
    })
    this.cached = {
      token: minted.accessToken,
      expiresAt: Date.now() + minted.expiresIn * 1000 - EXPIRY_MARGIN_MS,
    }
    return minted.accessToken
  }
}
