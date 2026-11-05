import type { Db } from '@dltech/atlas-db'

import type { SecretCipher } from '../config/secret-cipher'
import type { TokenFetch } from './anthropic-token-endpoint'

const TOKEN_URL = 'https://api.vercel.com/login/oauth/token'
const EXPIRY_MARGIN_MS = 60_000
const FALLBACK_LIFETIME_SECONDS = 3600

export type VercelOauthClient = { clientId: string; clientSecret: string }

export class VercelReconnectRequiredError extends Error {
  constructor() {
    super('the Vercel connection expired; connect Vercel again from settings')
    this.name = 'VercelReconnectRequiredError'
  }
}

type Grant = { accessToken: string; refreshToken: string | null; expiresIn: number }

class VercelGrantRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
  ) {
    super(`vercel token endpoint answered HTTP ${status}${code === null ? '' : ` (${code})`}`)
  }
}

type OauthRow = {
  sealedToken: string
  sealedRefreshToken: string | null
  accessTokenExpiresAt: Date | null
  oauthNeedsReconnect: boolean
}

export class VercelTokenRefresher {
  private readonly now: () => number

  constructor(
    private readonly args: {
      db: Db
      cipher: SecretCipher
      oauth: VercelOauthClient | null
      now?: (() => number) | undefined
      fetchFn?: TokenFetch | undefined
    },
  ) {
    this.now = args.now ?? Date.now
  }

  async refresh({ userId }: { userId: string }): Promise<string> {
    const { oauth } = this.args
    if (oauth === null) throw new VercelReconnectRequiredError()
    try {
      return await this.refreshInTransaction({ userId, oauth })
    } catch (error) {
      if (error instanceof VercelReconnectRequiredError) {
        await this.args.db.orm.public.UserVercelCredential.where({ userId })
          .updateAndCount({ oauthNeedsReconnect: true })
          .catch(() => 0)
      }
      throw error
    }
  }

  private refreshInTransaction(args: {
    userId: string
    oauth: VercelOauthClient
  }): Promise<string> {
    return this.args.db.transaction(async (tx) => {
      const lock = tx.raw
        .sql`SELECT pg_advisory_xact_lock(hashtext(${`vercel-oauth-refresh:${args.userId}`}))`
        .affectedCount()
        .build()
      await tx.execute(lock)
      const row = await tx.orm.public.UserVercelCredential.first({ userId: args.userId })
      if (row === null || row.kind !== 'oauth' || row.oauthNeedsReconnect) {
        throw new VercelReconnectRequiredError()
      }
      if (this.isFresh(row)) return this.open(row.sealedToken)
      if (row.sealedRefreshToken === null) throw new VercelReconnectRequiredError()
      const grant = await this.requestGrant({
        oauth: args.oauth,
        refreshToken: this.open(row.sealedRefreshToken),
      })
      await tx.orm.public.UserVercelCredential.where({ userId: args.userId }).updateAndCount({
        sealedToken: this.seal(grant.accessToken),
        ...(grant.refreshToken === null
          ? {}
          : { sealedRefreshToken: this.seal(grant.refreshToken) }),
        accessTokenExpiresAt: new Date(this.now() + grant.expiresIn * 1000),
      })
      return grant.accessToken
    })
  }

  private isFresh(row: OauthRow): boolean {
    return (
      row.accessTokenExpiresAt !== null &&
      row.accessTokenExpiresAt.getTime() - EXPIRY_MARGIN_MS > this.now()
    )
  }

  private async requestGrant(args: {
    oauth: VercelOauthClient
    refreshToken: string
  }): Promise<Grant> {
    try {
      return await this.postRefresh(args)
    } catch (error) {
      if (error instanceof VercelGrantRequestError && error.code === 'invalid_grant') {
        throw new VercelReconnectRequiredError()
      }
      throw error
    }
  }

  private async postRefresh(args: {
    oauth: VercelOauthClient
    refreshToken: string
  }): Promise<Grant> {
    const send = this.args.fetchFn ?? fetch
    const response = await send(TOKEN_URL, {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: args.oauth.clientId,
        client_secret: args.oauth.clientSecret,
        refresh_token: args.refreshToken,
      }),
    })
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null
    if (!response.ok) {
      const code = typeof payload?.error === 'string' ? payload.error : null
      throw new VercelGrantRequestError(response.status, code)
    }
    if (typeof payload?.access_token !== 'string') {
      throw new VercelGrantRequestError(response.status, null)
    }
    return {
      accessToken: payload.access_token,
      refreshToken: typeof payload.refresh_token === 'string' ? payload.refresh_token : null,
      expiresIn:
        typeof payload.expires_in === 'number' ? payload.expires_in : FALLBACK_LIFETIME_SECONDS,
    }
  }

  private seal(value: string): string {
    return this.args.cipher.encrypt(JSON.stringify(value))
  }

  private open(sealed: string): string {
    return JSON.parse(this.args.cipher.decrypt(sealed)) as string
  }
}
