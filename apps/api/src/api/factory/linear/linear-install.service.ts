import { randomUUID } from 'node:crypto'
import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common'
import { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { FactoryConnectionsService } from '../connections/connections.service'
import { EFactoryConnectionProvider } from '../factory.types'
import { credentialsFromToken, sealCredentials } from './linear-credentials'
import { exchangeCodeForToken, fetchOrganizationId } from './linear-oauth'

const AUTHORIZE_URL = 'https://linear.app/oauth/authorize'
const INSTALL_SCOPE = 'read,write,app:assignable,app:mentionable'
const STATE_TTL_MS = 10 * 60 * 1000

interface PendingInstall {
  organizationId: string
  expiresAt: number
}

@Injectable()
export class LinearInstallService {
  // In-memory install state: a restart mid-install just restarts the flow. v1 accepts this;
  // move to a table if installs ever need to survive a deploy.
  private readonly pending = new Map<string, PendingInstall>()

  constructor(
    private readonly env: EnvService,
    private readonly connections: FactoryConnectionsService,
    private readonly cipher: SecretCipherService,
  ) {}

  beginInstall(args: { organizationId: string; apiOrigin: string }): string {
    const clientId = this.clientCredentials().clientId
    this.sweepExpired()
    const state = randomUUID()
    this.pending.set(state, {
      organizationId: args.organizationId,
      expiresAt: Date.now() + STATE_TTL_MS,
    })

    const url = new URL(AUTHORIZE_URL)
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('redirect_uri', callbackUrl({ apiOrigin: args.apiOrigin }))
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', INSTALL_SCOPE)
    url.searchParams.set('actor', 'app')
    url.searchParams.set('state', state)
    return url.toString()
  }

  async completeInstall(args: { code: string; state: string; apiOrigin: string }): Promise<void> {
    const { clientId, clientSecret } = this.clientCredentials()
    const entry = this.pending.get(args.state)
    this.pending.delete(args.state)
    if (entry === undefined || entry.expiresAt < Date.now()) {
      throw new BadRequestException('unknown or expired linear install state')
    }

    const token = await exchangeCodeForToken({
      clientId,
      clientSecret,
      code: args.code,
      redirectUri: callbackUrl({ apiOrigin: args.apiOrigin }),
    })
    const workspaceId = await fetchOrganizationId({ accessToken: token.accessToken })
    const existing = await this.connections.resolve({
      provider: EFactoryConnectionProvider.Linear,
      externalAccountId: workspaceId,
    })
    if (existing !== null && existing.organizationId !== entry.organizationId) {
      throw new ConflictException(
        'this linear workspace is already connected to another organization',
      )
    }
    const credentials = credentialsFromToken({
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresIn: token.expiresIn,
    })
    await this.connections.upsert({
      provider: EFactoryConnectionProvider.Linear,
      externalAccountId: workspaceId,
      organizationId: entry.organizationId,
      status: 'active',
      sealedCredentials: sealCredentials({ cipher: this.cipher, credentials }),
      scopes: INSTALL_SCOPE,
    })
  }

  private clientCredentials(): { clientId: string; clientSecret: string } {
    const clientId = this.env.get('LINEAR_CLIENT_ID')
    const clientSecret = this.env.get('LINEAR_CLIENT_SECRET')
    if (clientId === undefined || clientSecret === undefined) {
      throw new ServiceUnavailableException('the linear oauth app is not configured yet')
    }
    return { clientId, clientSecret }
  }

  private sweepExpired(): void {
    const now = Date.now()
    for (const [state, entry] of this.pending) {
      if (entry.expiresAt < now) this.pending.delete(state)
    }
  }
}

function callbackUrl(args: { apiOrigin: string }): string {
  return `${args.apiOrigin}/v1/factory/linear/callback`
}
