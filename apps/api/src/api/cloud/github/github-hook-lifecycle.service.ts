import { randomBytes } from 'node:crypto'
import { Injectable, Logger } from '@nestjs/common'
import { Interval } from '@nestjs/schedule'
import { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { db } from '../../../db'
import { ERepoHookStatus } from './github-realtime.types'
import { GithubUserReads } from './github-user-reads'
import { GithubService } from './github.service'
import { isUniqueViolation } from './unique-violation'

const HOOK_EVENTS = ['pull_request', 'check_suite', 'check_run', 'push']
const IDLE_DELETE_AFTER_MS = 24 * 60 * 60 * 1_000
const SWEEP_LEASE_MS = 5 * 60 * 1_000

export type EnsureHookResult = 'created' | 'existing' | 'poll-backed'

@Injectable()
export class GithubHookLifecycleService {
  private readonly logger = new Logger(GithubHookLifecycleService.name)

  constructor(
    private readonly github: GithubService,
    private readonly reads: GithubUserReads,
    private readonly cipher: SecretCipherService,
    private readonly env: EnvService,
  ) {}

  async ensureHook(args: {
    userId: string
    repoFullName: string
  }): Promise<EnsureHookResult> {
    const hook = await db.githubRepoHook.findUnique({
      where: { repoFullName: args.repoFullName },
    })
    if (hook !== null) {
      if (hook.status === ERepoHookStatus.Orphaned) {
        return this.reconcile({ ...args, existingSecret: hook.secret })
      }
      return 'existing'
    }
    return this.createHook(args)
  }

  async markIdle(args: { repoFullName: string }): Promise<void> {
    await db.githubRepoHook.updateMany({
      where: { repoFullName: args.repoFullName, idleSince: null },
      data: { idleSince: new Date() },
    })
  }

  @Interval(60_000)
  async handleSweep(): Promise<void> {
    const now = new Date()
    const candidates = await db.githubRepoHook.findMany({
      where: {
        idleSince: { lt: new Date(now.getTime() - IDLE_DELETE_AFTER_MS) },
        status: ERepoHookStatus.Active,
      },
    })
    for (const candidate of candidates) {
      const claimed = await db.githubRepoHook.updateMany({
        where: {
          repoFullName: candidate.repoFullName,
          status: ERepoHookStatus.Active,
          OR: [{ sweepLeaseUntil: null }, { sweepLeaseUntil: { lt: now } }],
        },
        data: {
          sweepLeaseUntil: new Date(now.getTime() + SWEEP_LEASE_MS),
          status: ERepoHookStatus.Deleting,
        },
      })
      if (claimed.count === 1) await this.teardown({ repoFullName: candidate.repoFullName })
    }
  }

  private async reconcile(args: {
    userId: string
    repoFullName: string
    existingSecret: string
  }): Promise<EnsureHookResult> {
    const token = await this.github.findToken({ userId: args.userId })
    if (token === undefined) return 'poll-backed'

    const secret = randomHookSecret()
    const [owner, repo] = args.repoFullName.split('/') as [string, string]
    const result = await this.reads.createHook({
      token,
      owner,
      repo,
      config: { url: this.hookUrl({ repoFullName: args.repoFullName }), secret },
    })
    if (result.outcome === 'forbidden') return 'poll-backed'
    if (result.hookId === undefined) return 'poll-backed'

    await db.githubRepoHook.update({
      where: { repoFullName: args.repoFullName },
      data: {
        hookId: BigInt(result.hookId),
        secret: this.cipher.encrypt(secret),
        createdBy: args.userId,
        status: ERepoHookStatus.Active,
        idleSince: null,
      },
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
      await db.githubRepoHook.create({
        data: {
          repoFullName: args.repoFullName,
          hookId: BigInt(result.hookId),
          secret: this.cipher.encrypt(secret),
          createdBy: args.userId,
          status: ERepoHookStatus.Active,
        },
      })
      return result.outcome === 'adopted' ? 'existing' : 'created'
    } catch (failure) {
      if (isUniqueViolation(failure, ['repoFullName'])) return 'existing'
      throw failure
    }
  }

  private async teardown(args: { repoFullName: string }): Promise<void> {
    const hook = await db.githubRepoHook.findUnique({
      where: { repoFullName: args.repoFullName },
    })
    if (hook === null) return

    const token = await this.github.findToken({ userId: hook.createdBy })
    if (token === undefined) {
      await db.githubRepoHook.update({
        where: { repoFullName: args.repoFullName },
        data: { status: ERepoHookStatus.Orphaned, sweepLeaseUntil: null },
      })
      return
    }

    const [owner, repo] = args.repoFullName.split('/') as [string, string]
    const outcome = await this.reads.deleteHook({ token, owner, repo, hookId: Number(hook.hookId) })
    if (outcome === 'unauthorized') {
      await db.githubRepoHook.update({
        where: { repoFullName: args.repoFullName },
        data: { status: ERepoHookStatus.Orphaned, sweepLeaseUntil: null },
      })
      return
    }

    await db.githubRepoHook.deleteMany({ where: { repoFullName: args.repoFullName } })
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
