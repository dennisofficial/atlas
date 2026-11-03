import { BadRequestException, Injectable } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { EVercelPlan } from '@dltech/atlas-wire/web'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { openSecretValue } from '../secrets/sealed-secret'
import {
  listVercelProjects,
  listVercelTeams,
  readVercelPlan,
  VercelApiError,
} from './vercel-plan-reader'
import type { VercelProjectListing, VercelTeamListing } from './vercel-plan-reader'
import { VercelFetcher } from './vercel-oauth.types'
import { VercelTokenRefresher } from './vercel-token-refresher'

export type PlanSnapshot = {
  plan: EVercelPlan
  planCheckedAt: Date
}

export class VercelPlanReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VercelPlanReadError'
  }
}

@Injectable()
export class VercelPlanService {
  constructor(
    private readonly cipher: SecretCipherService,
    private readonly refresher: VercelTokenRefresher,
    private readonly fetcher: VercelFetcher,
  ) {}

  async readForToken(args: { token: string; teamId: string }): Promise<PlanSnapshot> {
    let plan: EVercelPlan
    try {
      plan = await readVercelPlan({
        fetch: this.fetcher.fetch,
        token: args.token,
        teamId: args.teamId,
      })
    } catch (failure) {
      if (failure instanceof VercelApiError) {
        throw new BadRequestException(`Vercel rejected the credential: ${failure.message}`)
      }
      throw new VercelPlanReadError(String(failure))
    }
    return { plan, planCheckedAt: new Date() }
  }

  async snapshotForUser(args: { userId: string }): Promise<PlanSnapshot> {
    const row = await db.orm.public.UserVercelCredential.first({ userId: args.userId })
    if (row === null) throw new BadRequestException('no Vercel credential is saved')
    const token = await this.accessTokenOf({ row })
    return this.readForToken({ token, teamId: row.teamId })
  }

  async refreshPlan(args: { userId: string }): Promise<PlanSnapshot> {
    const snapshot = await this.snapshotForUser(args)
    await db.orm.public.UserVercelCredential.where({ userId: args.userId }).updateAndCount({
      plan: snapshot.plan,
      planCheckedAt: snapshot.planCheckedAt,
    })
    return snapshot
  }

  async storedPlan(args: { userId: string; staleAfterMs: number }): Promise<PlanSnapshot | null> {
    const row = await db.orm.public.UserVercelCredential.first({ userId: args.userId })
    if (row === null) return null
    const stored = this.planOf({ plan: row.plan, planCheckedAt: row.planCheckedAt })
    const fresh =
      row.planCheckedAt !== null && Date.now() - row.planCheckedAt.getTime() < args.staleAfterMs
    if (stored !== null && fresh) return stored
    try {
      return await this.refreshPlan(args)
    } catch {
      return stored
    }
  }

  async projectsForToken(args: { token: string; teamId: string }): Promise<VercelProjectListing[]> {
    return listVercelProjects({ fetch: this.fetcher.fetch, token: args.token, teamId: args.teamId })
  }

  async teamsForToken(args: { token: string }): Promise<VercelTeamListing[]> {
    return listVercelTeams({ fetch: this.fetcher.fetch, token: args.token })
  }

  async discoverForUser(args: {
    userId: string
    token?: string | undefined
    teamId?: string | undefined
  }): Promise<{ teams: VercelTeamListing[]; projects: VercelProjectListing[] }> {
    const token = args.token ?? (await this.storedTokenOf({ userId: args.userId }))
    const teams = await this.teamsForToken({ token }).catch((failure) =>
      this.rethrowAsBadRequest({ failure }),
    )
    if (args.teamId === undefined) return { teams, projects: [] }
    const projects = await this.projectsForToken({ token, teamId: args.teamId }).catch((failure) =>
      this.rethrowAsBadRequest({ failure }),
    )
    return { teams, projects }
  }

  async projectsForUser(args: { userId: string }): Promise<VercelProjectListing[]> {
    const row = await db.orm.public.UserVercelCredential.first({ userId: args.userId })
    if (row === null) return []
    try {
      const token = await this.accessTokenOf({ row })
      return await listVercelProjects({ fetch: this.fetcher.fetch, token, teamId: row.teamId })
    } catch {
      return []
    }
  }

  private async accessTokenOf(args: {
    row: {
      userId: string
      kind: string
      sealedToken: string
      sealedRefreshToken: string | null
      accessTokenExpiresAt: Date | null
    }
  }): Promise<string> {
    const { row } = args
    if (row.kind !== 'oauth') {
      return openSecretValue({ cipher: this.cipher, sealed: row.sealedToken })
    }
    return this.refresher.accessToken({ userId: row.userId })
  }

  private rethrowAsBadRequest(args: { failure: unknown }): never {
    const { failure } = args
    if (failure instanceof VercelApiError) {
      throw new BadRequestException(`Vercel rejected the token: ${failure.message}`)
    }
    throw failure
  }

  private async storedTokenOf(args: { userId: string }): Promise<string> {
    const row = await db.orm.public.UserVercelCredential.first({ userId: args.userId })
    if (row === null) throw new BadRequestException('paste a token or save one first')
    return this.accessTokenOf({ row })
  }

  private planOf(args: { plan: string | null; planCheckedAt: Date | null }): PlanSnapshot | null {
    if (args.plan === null || args.planCheckedAt === null) return null
    const plan = args.plan as EVercelPlan
    if (!Object.values(EVercelPlan).includes(plan)) return null
    return { plan, planCheckedAt: args.planCheckedAt }
  }
}
