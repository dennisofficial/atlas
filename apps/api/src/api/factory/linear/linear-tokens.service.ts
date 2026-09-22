import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { FactoryConnectionsService } from '../connections/connections.service'
import { EFactoryConnectionProvider } from '../factory.types'
import {
  credentialsFromToken,
  EXPIRY_MARGIN_MS,
  isFresh,
  openCredentials,
  sealCredentials,
  type LinearConnectionCredentials,
} from './linear-credentials'
import { refreshAccessToken } from './linear-oauth'

interface CachedToken {
  token: string
  expiresAt: number
}

@Injectable()
export class LinearTokensService {
  private readonly cached = new Map<string, CachedToken>()
  private readonly forcedStale = new Set<string>()
  private readonly refreshing = new Map<string, Promise<string>>()

  constructor(
    private readonly env: EnvService,
    private readonly connections: FactoryConnectionsService,
    private readonly cipher: SecretCipherService,
  ) {}

  async getToken(args: { workspaceId: string }): Promise<string> {
    const hit = this.cached.get(args.workspaceId)
    if (hit !== undefined && hit.expiresAt > Date.now() && !this.isForcedStale(args.workspaceId)) {
      return hit.token
    }

    const connection = await this.connections.resolve({
      provider: EFactoryConnectionProvider.Linear,
      externalAccountId: args.workspaceId,
    })
    if (connection === null || connection.status !== 'active') {
      throw new NotFoundException('no active linear connection for this workspace')
    }
    if (connection.sealedCredentials === null) {
      throw new ServiceUnavailableException(
        'the linear connection holds no credentials — reinstall linear to reconnect it',
      )
    }

    const credentials = openCredentials({
      cipher: this.cipher,
      sealed: connection.sealedCredentials,
    })
    if (credentials === null) {
      throw new ServiceUnavailableException(
        'the linear connection credentials could not be unsealed — reinstall linear to reconnect it',
      )
    }
    if (isFresh(credentials) && !this.isForcedStale(args.workspaceId)) {
      this.remember({ workspaceId: args.workspaceId, credentials })
      return credentials.accessToken
    }
    return this.refreshOnce({
      connectionId: connection.id,
      workspaceId: args.workspaceId,
      credentials,
    })
  }

  // A 401 from the Linear API means the token died early (revoked install, rotated secret), so
  // the next call must refresh even while the sealed expiry still looks fresh.
  // https://linear.app/developers/oauth-2-0-authentication
  invalidate(args: { workspaceId: string }): void {
    this.cached.delete(args.workspaceId)
    this.forcedStale.add(args.workspaceId)
  }

  private isForcedStale(workspaceId: string): boolean {
    return this.forcedStale.has(workspaceId)
  }

  private refreshOnce(args: {
    connectionId: string
    workspaceId: string
    credentials: LinearConnectionCredentials
  }): Promise<string> {
    const inFlight = this.refreshing.get(args.workspaceId)
    if (inFlight !== undefined) return inFlight

    const pending = this.refresh(args).finally(() => {
      this.refreshing.delete(args.workspaceId)
    })
    this.refreshing.set(args.workspaceId, pending)
    return pending
  }

  private async refresh(args: {
    connectionId: string
    workspaceId: string
    credentials: LinearConnectionCredentials
  }): Promise<string> {
    if (args.credentials.refreshToken === null) {
      throw new ServiceUnavailableException(
        'the linear connection token expired and holds no refresh token — reinstall linear to reconnect it',
      )
    }
    const clientId = this.env.get('LINEAR_CLIENT_ID')
    const clientSecret = this.env.get('LINEAR_CLIENT_SECRET')
    if (clientId === undefined || clientSecret === undefined) {
      throw new ServiceUnavailableException('the linear oauth app is not configured yet')
    }

    const minted = await refreshAccessToken({
      clientId,
      clientSecret,
      refreshToken: args.credentials.refreshToken,
    })
    const next = credentialsFromToken({
      accessToken: minted.accessToken,
      refreshToken: minted.refreshToken ?? args.credentials.refreshToken,
      expiresIn: minted.expiresIn,
    })
    await this.connections.updateCredentials({
      id: args.connectionId,
      sealedCredentials: sealCredentials({ cipher: this.cipher, credentials: next }),
    })
    this.forcedStale.delete(args.workspaceId)
    this.remember({ workspaceId: args.workspaceId, credentials: next })
    return next.accessToken
  }

  private remember(args: {
    workspaceId: string
    credentials: LinearConnectionCredentials
  }): void {
    this.cached.set(args.workspaceId, {
      token: args.credentials.accessToken,
      expiresAt: args.credentials.expiresAt - EXPIRY_MARGIN_MS,
    })
  }
}
