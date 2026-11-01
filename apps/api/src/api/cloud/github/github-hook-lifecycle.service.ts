import { randomBytes } from 'node:crypto'
import { EGithubCallSource } from './github-call-log'
import { Injectable, Logger } from '@nestjs/common'
import { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { db, or } from '@dltech/atlas-db'
import { HOOK_EVENTS as GITHUB_HOOK_EVENTS } from './github-hook-events'
import { ERepoHookStatus } from './github-realtime.types'
import { GithubAppInstallationsService } from './github-app-installations.service'
import { GithubUserReads } from './github-user-reads'
import { GithubService } from './github.service'
import { isUniqueViolation } from './unique-violation'
import { normalizedRepo, repoPattern } from './github-pr-identity'
import { GithubObservationStore } from './github-observation.store'
import { withGithubRequestBudget } from './github-request-budget'

export const HOOK_EVENTS = GITHUB_HOOK_EVENTS
const IDLE_DELETE_AFTER_MS = 24 * 60 * 60 * 1_000
const SWEEP_LEASE_MS = 5 * 60 * 1_000
const VERIFY_HOOK_TTL_MS = 5 * 60 * 1_000
const REPO_HOOK_PRIMARY_KEY = 'GithubRepoHook_pkey'

export type EnsureHookResult = 'created' | 'existing' | 'app-backed' | 'poll-backed'

@Injectable()
export class GithubHookLifecycleService {
  private readonly logger = new Logger(GithubHookLifecycleService.name)
  private readonly verifiedAliveAt = new Map<string, number>()

  constructor(
    private readonly github: GithubService,
    private readonly reads: GithubUserReads,
    private readonly cipher: SecretCipherService,
    private readonly env: EnvService,
    private readonly installations: GithubAppInstallationsService,
    private readonly observations: GithubObservationStore,
  ) {}

  ensureHook(args: { userId: string; repoFullName: string }): Promise<EnsureHookResult> {
    return withGithubRequestBudget({
      store: this.observations,
      run: () =>
        this.ensureWithinBudget({ ...args, repoFullName: normalizedRepo(args.repoFullName) }),
    })
  }

  private async ensureWithinBudget(args: {
    userId: string
    repoFullName: string
  }): Promise<EnsureHookResult> {
    if (await this.installations.coversRepo({ repoFullName: args.repoFullName })) {
      return 'app-backed'
    }
    const hook = await db.orm.public.GithubRepoHook.where((hook) =>
      hook.repoFullName.ilike(repoPattern(args.repoFullName)),
    ).first()
    if (hook !== null) {
      if (hook.status === ERepoHookStatus.Orphaned) {
        return this.reconcile({ ...args, storedRepo: hook.repoFullName })
      }
      const alive = await this.isHookAlive({
        userId: args.userId,
        repoFullName: args.repoFullName,
        hookId: hook.hookId,
      })
      if (alive) return 'existing'
      return this.reconcile({ ...args, storedRepo: hook.repoFullName })
    }
    return this.createHook(args)
  }

  async markIdle(args: { repoFullName: string }): Promise<void> {
    await db.orm.public.GithubRepoHook.where({
      repoFullName: args.repoFullName,
      idleSince: null,
    }).updateAndCount({ idleSince: new Date() })
  }

  handleSweep(): Promise<void> {
    return withGithubRequestBudget({
      store: this.observations,
      run: () => this.sweepWithinBudget(),
    })
  }

  private async sweepWithinBudget(): Promise<void> {
    const now = new Date()
    const idleCutoff = new Date(now.getTime() - IDLE_DELETE_AFTER_MS)
    const candidates = await db.orm.public.GithubRepoHook.where((hook) =>
      hook.idleSince.lt(idleCutoff),
    )
      .where({ status: ERepoHookStatus.Active })
      .all()
    for (const candidate of candidates) {
      if (
        await this.observations
          .hasRepo({ repoFullName: candidate.repoFullName })
          .catch((failure: unknown) => {
            this.logger.warn(
              `PR observation presence unavailable during hook cleanup: ${String(failure)}`,
            )
            return true
          })
      ) {
        await db.orm.public.GithubRepoHook.where({
          repoFullName: candidate.repoFullName,
        }).updateAndCount({ idleSince: null })
        continue
      }
      const claimed = await db.orm.public.GithubRepoHook.where({
        repoFullName: candidate.repoFullName,
        status: ERepoHookStatus.Active,
      })
        .where((hook) => or(hook.sweepLeaseUntil.isNull(), hook.sweepLeaseUntil.lt(now)))
        .updateAndCount({
          sweepLeaseUntil: new Date(now.getTime() + SWEEP_LEASE_MS),
          status: ERepoHookStatus.Deleting,
        })
      if (claimed !== 1) continue
      try {
        await this.teardown({ repoFullName: candidate.repoFullName })
      } catch (failure) {
        await db.orm.public.GithubRepoHook.where({
          repoFullName: candidate.repoFullName,
        }).updateAndCount({ status: ERepoHookStatus.Active, sweepLeaseUntil: null })
        this.logger.warn(`hook cleanup paused: ${String(failure)}`)
        return
      }
    }
  }

  private async isHookAlive(args: {
    userId: string
    repoFullName: string
    hookId: bigint
  }): Promise<boolean> {
    const verified = this.verifiedAliveAt.get(args.repoFullName)
    if (verified !== undefined && Date.now() - verified < VERIFY_HOOK_TTL_MS) return true

    const token = await this.github.findToken({ userId: args.userId })
    if (token === undefined) return true

    const [owner, repo] = args.repoFullName.split('/') as [string, string]
    let result: 'found' | 'missing' | 'unauthorized'
    try {
      result = await this.reads.getHook({
        source: EGithubCallSource.HookLifecycle,
        token,
        owner,
        repo,
        hookId: Number(args.hookId),
      })
      if (result === 'found') {
        await this.reconcileEvents({ token, owner, repo, hookId: Number(args.hookId) })
      }
    } catch (failure) {
      this.logger.warn(`verifying the hook for ${args.repoFullName} failed: ${String(failure)}`)
      return true
    }
    if (result === 'found' || result === 'unauthorized') {
      this.verifiedAliveAt.set(args.repoFullName, Date.now())
      return true
    }
    return false
  }

  private async reconcileEvents(args: {
    token: string
    owner: string
    repo: string
    hookId: number
  }): Promise<void> {
    const current = await this.reads.getHookEvents({
      ...args,
      source: EGithubCallSource.HookLifecycle,
    })
    const missing = HOOK_EVENTS.filter((event) => !current.includes(event))
    if (missing.length === 0) return
    await this.reads.updateHook({
      ...args,
      source: EGithubCallSource.HookLifecycle,
      events: [...current, ...missing],
    })
  }

  private async reconcile(args: {
    userId: string
    repoFullName: string
    storedRepo: string
  }): Promise<EnsureHookResult> {
    const token = await this.github.findToken({ userId: args.userId })
    if (token === undefined) return 'poll-backed'

    const secret = randomHookSecret()
    const [owner, repo] = args.repoFullName.split('/') as [string, string]
    const result = await this.reads.createHook({
      source: EGithubCallSource.HookLifecycle,
      token,
      owner,
      repo,
      config: { url: this.hookUrl({ repoFullName: args.repoFullName }), secret },
    })
    if (result.outcome === 'forbidden') return 'poll-backed'
    if (result.hookId === undefined) return 'poll-backed'

    await db.orm.public.GithubRepoHook.where({ repoFullName: args.storedRepo }).update({
      hookId: BigInt(result.hookId),
      secret: this.cipher.encrypt(secret),
      createdBy: args.userId,
      status: ERepoHookStatus.Active,
      idleSince: null,
    })
    return result.outcome === 'adopted' ? 'existing' : 'created'
  }

  private async createHook(args: {
    userId: string
    repoFullName: string
  }): Promise<EnsureHookResult> {
    const token = await this.github.findToken({ userId: args.userId })
    if (token === undefined) return 'poll-backed'

    const secret = randomHookSecret()
    const [owner, repo] = args.repoFullName.split('/') as [string, string]
    const result = await this.reads.createHook({
      source: EGithubCallSource.HookLifecycle,
      token,
      owner,
      repo,
      config: { url: this.hookUrl({ repoFullName: args.repoFullName }), secret },
    })
    if (result.outcome === 'forbidden') return 'poll-backed'
    if (result.hookId === undefined) {
      this.logger.warn(`github created/adopted no hook id for ${args.repoFullName}`)
      return 'poll-backed'
    }

    try {
      await db.orm.public.GithubRepoHook.create({
        repoFullName: args.repoFullName,
        hookId: BigInt(result.hookId),
        secret: this.cipher.encrypt(secret),
        createdBy: args.userId,
        status: ERepoHookStatus.Active,
      })
      return result.outcome === 'adopted' ? 'existing' : 'created'
    } catch (failure) {
      if (isUniqueViolation({ error: failure, constraint: REPO_HOOK_PRIMARY_KEY }))
        return 'existing'
      throw failure
    }
  }

  private async teardown(args: { repoFullName: string }): Promise<void> {
    const hook = await db.orm.public.GithubRepoHook.where((hook) =>
      hook.repoFullName.ilike(repoPattern(args.repoFullName)),
    ).first()
    if (hook === null) return

    const token = await this.github.findToken({ userId: hook.createdBy })
    if (token === undefined) {
      await db.orm.public.GithubRepoHook.where({ repoFullName: args.repoFullName }).update({
        status: ERepoHookStatus.Orphaned,
        sweepLeaseUntil: null,
      })
      return
    }

    const [owner, repo] = args.repoFullName.split('/') as [string, string]
    const outcome = await this.reads.deleteHook({
      source: EGithubCallSource.HookSweep,
      token,
      owner,
      repo,
      hookId: Number(hook.hookId),
    })
    if (outcome === 'unauthorized') {
      await db.orm.public.GithubRepoHook.where({ repoFullName: args.repoFullName }).update({
        status: ERepoHookStatus.Orphaned,
        sweepLeaseUntil: null,
      })
      return
    }

    await db.orm.public.GithubRepoHook.where({ repoFullName: args.repoFullName }).deleteAndCount()
  }

  private hookUrl(args: { repoFullName: string }): string {
    const base = this.env.get('BETTER_AUTH_URL')
    if (base === undefined || base.length === 0) {
      throw new Error('BETTER_AUTH_URL is not configured — cannot build the hook url')
    }
    return `${base}/v1/github/hooks/${encodeURIComponent(args.repoFullName)}`
  }
}

function randomHookSecret(): string {
  return randomBytes(32).toString('hex')
}
