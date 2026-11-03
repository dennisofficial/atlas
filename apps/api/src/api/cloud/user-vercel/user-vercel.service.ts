import type { Row } from '@dltech/atlas-db'
import {
  EVercelConnectStartOutcome,
  EVercelCredentialKind,
  EVercelPlan,
  VERCEL_CONNECT_REASON_PARAM,
  VERCEL_CONNECT_RESULT_PARAM,
  VERCEL_CONNECT_SETTINGS_PATH,
  type UserVercelCredential,
  type UserVercelCredentialUpsert,
  type VercelConnectStart,
} from '@dltech/atlas-wire/web'
import { BadRequestException, Injectable } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { sealJson, unsealJson } from '../mcp-oauth/mcp-oauth-seal'
import { openSecretValue, sealSecretValue } from '../secrets/sealed-secret'
import { VercelPlanService } from './vercel-credential-plan'
import {
  exchangeVercelAuthorizationCode,
  idTokenNonceOf,
  revokeVercelToken,
  vercelAuthorizeUrl,
  vercelPkce,
  vercelUserIdOf,
} from './vercel-oauth-client'
import { listVercelTeams } from './vercel-plan-reader'
import { VercelTokenRefresher } from './vercel-token-refresher'
import {
  sealedVercelPendingSchema,
  VERCEL_OAUTH_PENDING_TAG,
  VercelFetcher,
  VercelOauthConfig,
} from './vercel-oauth.types'

const PENDING_TTL_MS = 10 * 60_000
const PLAN_FRESH_MS = 60 * 60_000

const planValueOf = (plan: string | null): EVercelPlan => {
  const known = Object.values(EVercelPlan) as string[]
  return plan !== null && known.includes(plan) ? (plan as EVercelPlan) : EVercelPlan.Unknown
}

const UNCONFIGURED: UserVercelCredential = {
  configured: false,
  kind: EVercelCredentialKind.Token,
  teamId: null,
  vercelProjectId: null,
  plan: EVercelPlan.Unknown,
  planCheckedAt: null,
  needsReconnect: false,
  vercelUserId: null,
  oauthConfigured: false,
  updatedAt: null,
}

@Injectable()
export class UserVercelService {
  constructor(
    private readonly cipher: SecretCipherService,
    private readonly env: EnvService,
    private readonly refresher: VercelTokenRefresher,
    private readonly plans: VercelPlanService,
    private readonly config: VercelOauthConfig,
    private readonly fetcher: VercelFetcher,
  ) {}

  async read(args: { userId: string }): Promise<UserVercelCredential> {
    const row = await db.orm.public.UserVercelCredential.first({ userId: args.userId })
    if (row === null) return { ...UNCONFIGURED, oauthConfigured: this.refresher.oauthConfigured() }
    const stale =
      row.planCheckedAt === null || Date.now() - row.planCheckedAt.getTime() > PLAN_FRESH_MS
    if (stale) {
      await this.plans.refreshPlan(args).catch(() => undefined)
      const fresh = await db.orm.public.UserVercelCredential.first({ userId: args.userId })
      if (fresh !== null) return this.viewOf({ row: fresh })
    }
    return this.viewOf({ row })
  }

  async connectStart(args: { userId: string }): Promise<VercelConnectStart> {
    const clientId = this.env.get('VERCEL_OAUTH_CLIENT_ID')
    const clientSecret = this.env.get('VERCEL_OAUTH_CLIENT_SECRET')
    if (clientId === undefined || clientSecret === undefined) {
      return { outcome: EVercelConnectStartOutcome.NotConfigured }
    }
    const pkce = vercelPkce()
    await db.orm.public.McpOauthPending.create({
      id: pkce.state,
      userId: args.userId,
      serverUrl: VERCEL_OAUTH_PENDING_TAG,
      sealed: sealJson({
        cipher: this.cipher,
        value: { codeVerifier: pkce.verifier, nonce: pkce.nonce },
      }),
      returnTo: VERCEL_CONNECT_SETTINGS_PATH,
      expiresAt: new Date(Date.now() + PENDING_TTL_MS),
    })
    return {
      outcome: EVercelConnectStartOutcome.Redirect,
      url: vercelAuthorizeUrl({
        clientId,
        redirectUri: this.config.redirectUri,
        state: pkce.state,
        nonce: pkce.nonce,
        challenge: pkce.challenge,
      }),
    }
  }

  async completeCallback(args: {
    state?: string | undefined
    code?: string | undefined
    error?: string | undefined
    errorDescription?: string | undefined
    sessionUserId?: string | undefined
  }): Promise<string> {
    const pending =
      args.state === undefined || args.state === ''
        ? null
        : await this.takePending({ id: args.state })
    if (pending === null) return this.redirect({ result: 'error', reason: 'unknown_state' })
    const failed = (reason: string) => this.redirect({ result: 'error', reason })
    if (args.sessionUserId !== pending.userId) return failed('session_mismatch')
    if (pending.expiresAt.getTime() < Date.now()) return failed('expired')
    if (args.error !== undefined) return failed(args.errorDescription ?? args.error)
    if (args.code === undefined || args.code === '') return failed('missing_code')
    try {
      const result = await this.finishConnect({
        userId: pending.userId,
        code: args.code,
        sealed: pending.sealed,
      })
      return this.redirect({ result })
    } catch {
      return failed('exchange_failed')
    }
  }

  async refreshPlan(args: { userId: string }): Promise<UserVercelCredential> {
    await this.plans.refreshPlan(args)
    return this.read(args)
  }

  async projects(args: { userId: string }): Promise<{ id: string; name: string }[]> {
    return this.plans.projectsForUser(args)
  }

  async chooseProject(args: {
    userId: string
    vercelProjectId: string
  }): Promise<UserVercelCredential> {
    const count = await db.orm.public.UserVercelCredential.where({
      userId: args.userId,
    }).updateAndCount({
      vercelProjectId: args.vercelProjectId,
    })
    if (count === 0) throw new BadRequestException('connect Vercel first')
    return this.read(args)
  }

  async write(args: { userId: string; input: UserVercelCredentialUpsert }): Promise<void> {
    const { userId, input } = args
    if (input.token === undefined) {
      const count = await db.orm.public.UserVercelCredential.where({ userId }).updateAndCount({
        teamId: input.teamId,
        vercelProjectId: input.vercelProjectId,
      })
      if (count === 0) throw new BadRequestException('a token is required the first time')
      await this.plans.refreshPlan({ userId }).catch(() => undefined)
      return
    }
    const snapshot = await this.plans.readForToken({ token: input.token, teamId: input.teamId })
    await db.orm.public.UserVercelCredential.upsert({
      conflictOn: { userId },
      create: {
        userId,
        kind: EVercelCredentialKind.Token,
        sealedToken: sealSecretValue({ cipher: this.cipher, value: input.token }),
        sealedRefreshToken: null,
        accessTokenExpiresAt: null,
        teamId: input.teamId,
        vercelProjectId: input.vercelProjectId,
        plan: snapshot.plan,
        planCheckedAt: snapshot.planCheckedAt,
        vercelUserId: null,
        oauthNeedsReconnect: false,
      },
      update: {
        kind: EVercelCredentialKind.Token,
        sealedToken: sealSecretValue({ cipher: this.cipher, value: input.token }),
        sealedRefreshToken: null,
        accessTokenExpiresAt: null,
        teamId: input.teamId,
        vercelProjectId: input.vercelProjectId,
        plan: snapshot.plan,
        planCheckedAt: snapshot.planCheckedAt,
        vercelUserId: null,
        oauthNeedsReconnect: false,
      },
    })
  }

  async remove(args: { userId: string }): Promise<void> {
    const row = await db.orm.public.UserVercelCredential.first({ userId: args.userId })
    if (
      row !== null &&
      row.kind === EVercelCredentialKind.Oauth &&
      row.sealedRefreshToken !== null
    ) {
      const clientId = this.env.get('VERCEL_OAUTH_CLIENT_ID')
      const clientSecret = this.env.get('VERCEL_OAUTH_CLIENT_SECRET')
      if (clientId !== undefined && clientSecret !== undefined) {
        try {
          await revokeVercelToken({
            fetch: this.fetcher.fetch,
            clientId,
            clientSecret,
            token: openSecretValue({ cipher: this.cipher, sealed: row.sealedRefreshToken }),
          })
        } catch {
          // revoke is best-effort; the row is removed regardless
        }
      }
    }
    await db.orm.public.UserVercelCredential.where({ userId: args.userId }).deleteAndCount()
  }

  viewOf(args: { row: Row<'UserVercelCredential'> }): UserVercelCredential {
    const { row } = args
    return {
      configured: true,
      kind:
        row.kind === EVercelCredentialKind.Oauth
          ? EVercelCredentialKind.Oauth
          : EVercelCredentialKind.Token,
      teamId: row.teamId,
      vercelProjectId: row.vercelProjectId,
      plan: planValueOf(row.plan),
      planCheckedAt: row.planCheckedAt === null ? null : row.planCheckedAt.toISOString(),
      needsReconnect: row.oauthNeedsReconnect,
      vercelUserId: row.vercelUserId,
      oauthConfigured: this.refresher.oauthConfigured(),
      updatedAt: row.updatedAt.toISOString(),
    }
  }

  private async finishConnect(args: {
    userId: string
    code: string
    sealed: string
  }): Promise<'connected' | 'choose-project'> {
    const clientId = this.env.get('VERCEL_OAUTH_CLIENT_ID')
    const clientSecret = this.env.get('VERCEL_OAUTH_CLIENT_SECRET')
    if (clientId === undefined || clientSecret === undefined) {
      throw new BadRequestException('vercel oauth is not configured')
    }
    const pending = unsealJson({
      cipher: this.cipher,
      sealed: args.sealed,
      schema: sealedVercelPendingSchema,
    })
    const grant = await exchangeVercelAuthorizationCode({
      fetch: this.fetcher.fetch,
      clientId,
      clientSecret,
      code: args.code,
      verifier: pending.codeVerifier,
      redirectUri: this.config.redirectUri,
    })
    if (grant.idToken !== null && idTokenNonceOf(grant.idToken) !== pending.nonce) {
      throw new BadRequestException('vercel oauth nonce mismatch')
    }
    const vercelUserId = await vercelUserIdOf({
      fetch: this.fetcher.fetch,
      accessToken: grant.accessToken,
    })
    const teams = await listVercelTeams({ fetch: this.fetcher.fetch, token: grant.accessToken })
    if (teams.length === 0) throw new BadRequestException('the Vercel account holds no team')
    const team = teams[0] as { id: string; slug: string; plan: EVercelPlan }
    const projects = await this.plans
      .projectsForToken({ token: grant.accessToken, teamId: team.id })
      .catch(() => [])
    const vercelProjectId = projects.length === 1 ? (projects[0] as { id: string }).id : null
    const planCheckedAt = new Date()
    await db.orm.public.UserVercelCredential.upsert({
      conflictOn: { userId: args.userId },
      create: {
        userId: args.userId,
        kind: EVercelCredentialKind.Oauth,
        sealedToken: sealSecretValue({ cipher: this.cipher, value: grant.accessToken }),
        sealedRefreshToken:
          grant.refreshToken === null
            ? null
            : sealSecretValue({ cipher: this.cipher, value: grant.refreshToken }),
        accessTokenExpiresAt: new Date(planCheckedAt.getTime() + grant.expiresIn * 1000),
        teamId: team.id,
        vercelProjectId,
        plan: team.plan,
        planCheckedAt,
        vercelUserId,
        oauthNeedsReconnect: false,
      },
      update: {
        kind: EVercelCredentialKind.Oauth,
        sealedToken: sealSecretValue({ cipher: this.cipher, value: grant.accessToken }),
        sealedRefreshToken:
          grant.refreshToken === null
            ? null
            : sealSecretValue({ cipher: this.cipher, value: grant.refreshToken }),
        accessTokenExpiresAt: new Date(planCheckedAt.getTime() + grant.expiresIn * 1000),
        teamId: team.id,
        vercelProjectId,
        plan: team.plan,
        planCheckedAt,
        vercelUserId,
        oauthNeedsReconnect: false,
      },
    })
    return vercelProjectId === null ? 'choose-project' : 'connected'
  }

  private async takePending(args: { id: string }): Promise<{
    userId: string
    sealed: string
    expiresAt: Date
  } | null> {
    const row = await db.orm.public.McpOauthPending.first({ id: args.id })
    if (row === null || row.serverUrl !== VERCEL_OAUTH_PENDING_TAG) return null
    const count = await db.orm.public.McpOauthPending.where({ id: args.id }).deleteAndCount()
    if (count !== 1) return null
    return { userId: row.userId, sealed: row.sealed, expiresAt: row.expiresAt }
  }

  private redirect(args: {
    result: 'connected' | 'choose-project' | 'error'
    reason?: string
  }): string {
    const url = new URL(VERCEL_CONNECT_SETTINGS_PATH, new URL(this.config.webOrigin).origin)
    url.searchParams.set(VERCEL_CONNECT_RESULT_PARAM, args.result)
    if (args.reason !== undefined) {
      url.searchParams.set(VERCEL_CONNECT_REASON_PARAM, args.reason.slice(0, 200))
    }
    return url.toString()
  }
}
