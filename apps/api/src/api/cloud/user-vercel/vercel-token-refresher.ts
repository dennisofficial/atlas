import { Injectable, Logger } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { openSecretValue, sealSecretValue } from '../secrets/sealed-secret'
import {
  refreshVercelToken,
  VercelOauthRequestError,
  type VercelTokenGrant,
} from './vercel-oauth-client'
import { VercelFetcher } from './vercel-oauth.types'

const EXPIRY_MARGIN_MS = 60_000

export class VercelReconnectRequiredError extends Error {
  constructor() {
    super('the Vercel connection expired — connect Vercel again from settings')
    this.name = 'VercelReconnectRequiredError'
  }
}

type OauthRow = {
  sealedToken: string
  sealedRefreshToken: string | null
  accessTokenExpiresAt: Date | null
  oauthNeedsReconnect: boolean
}

@Injectable()
export class VercelTokenRefresher {
  private readonly logger = new Logger(VercelTokenRefresher.name)

  constructor(
    private readonly cipher: SecretCipherService,
    private readonly env: EnvService,
    private readonly fetcher: VercelFetcher,
  ) {}

  oauthConfigured(): boolean {
    const clientId = this.env.get('VERCEL_OAUTH_CLIENT_ID')
    const clientSecret = this.env.get('VERCEL_OAUTH_CLIENT_SECRET')
    return (
      clientId !== undefined && clientId !== '' && clientSecret !== undefined && clientSecret !== ''
    )
  }

  async accessToken(args: { userId: string }): Promise<string> {
    const row = await db.orm.public.UserVercelCredential.first({ userId: args.userId })
    if (row === null) throw new VercelReconnectRequiredError()
    if (row.kind !== 'oauth') {
      return openSecretValue({ cipher: this.cipher, sealed: row.sealedToken })
    }
    if (row.oauthNeedsReconnect) throw new VercelReconnectRequiredError()
    if (this.isFresh(row)) {
      return openSecretValue({ cipher: this.cipher, sealed: row.sealedToken })
    }
    return this.refreshLocked({ userId: args.userId })
  }

  private isFresh(row: OauthRow): boolean {
    return (
      row.accessTokenExpiresAt !== null &&
      row.accessTokenExpiresAt.getTime() - EXPIRY_MARGIN_MS > Date.now()
    )
  }

  private async refreshLocked(args: { userId: string }): Promise<string> {
    const clientId = this.env.get('VERCEL_OAUTH_CLIENT_ID')
    const clientSecret = this.env.get('VERCEL_OAUTH_CLIENT_SECRET')
    if (clientId === undefined || clientSecret === undefined) {
      throw new VercelReconnectRequiredError()
    }
    try {
      return await this.refreshInTransaction({ ...args, clientId, clientSecret })
    } catch (failure) {
      if (failure instanceof VercelReconnectRequiredError) {
        await db.orm.public.UserVercelCredential.where({ userId: args.userId })
          .updateAndCount({ oauthNeedsReconnect: true })
          .catch(() => 0)
      }
      throw failure
    }
  }

  private async refreshInTransaction(args: {
    userId: string
    clientId: string
    clientSecret: string
  }): Promise<string> {
    const { clientId, clientSecret } = args
    return db.transaction(async (tx) => {
      const statement = tx.raw
        .sql`SELECT pg_advisory_xact_lock(hashtext(${`vercel-oauth-refresh:${args.userId}`}))`
        .affectedCount()
        .build()
      await tx.execute(statement)
      const row = await tx.orm.public.UserVercelCredential.first({ userId: args.userId })
      if (row === null || row.kind !== 'oauth') throw new VercelReconnectRequiredError()
      if (row.oauthNeedsReconnect) throw new VercelReconnectRequiredError()
      if (this.isFresh(row)) {
        return openSecretValue({ cipher: this.cipher, sealed: row.sealedToken })
      }
      if (row.sealedRefreshToken === null) throw new VercelReconnectRequiredError()
      const grant = await this.requestGrant({
        clientId,
        clientSecret,
        refreshToken: openSecretValue({ cipher: this.cipher, sealed: row.sealedRefreshToken }),
      })
      const expiresAt = new Date(Date.now() + grant.expiresIn * 1000)
      await tx.orm.public.UserVercelCredential.where({ userId: args.userId }).updateAndCount({
        sealedToken: sealSecretValue({ cipher: this.cipher, value: grant.accessToken }),
        ...(grant.refreshToken === null
          ? {}
          : {
              sealedRefreshToken: sealSecretValue({
                cipher: this.cipher,
                value: grant.refreshToken,
              }),
            }),
        accessTokenExpiresAt: expiresAt,
      })
      return grant.accessToken
    })
  }

  private async requestGrant(args: {
    clientId: string
    clientSecret: string
    refreshToken: string
  }): Promise<VercelTokenGrant> {
    try {
      return await refreshVercelToken({
        fetch: this.fetcher.fetch,
        clientId: args.clientId,
        clientSecret: args.clientSecret,
        refreshToken: args.refreshToken,
      })
    } catch (failure) {
      if (failure instanceof VercelOauthRequestError && failure.code === 'invalid_grant') {
        throw new VercelReconnectRequiredError()
      }
      this.logger.warn(`vercel token refresh failed: ${String(failure)}`)
      throw failure
    }
  }
}
