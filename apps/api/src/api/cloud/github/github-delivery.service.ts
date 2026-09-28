import { Injectable, Logger } from '@nestjs/common'
import { db } from '../../../db'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import { payloadFieldsOf } from './github-pr-payload'
import type { GithubPrStateDto, GithubPrStateFields } from './github-realtime.types'
import { GithubUserReadFailed, GithubUserReads } from './github-user-reads'
import { GithubService } from './github.service'
import type {
  GithubCheckRunWebhookPayload,
  GithubCheckSuiteWebhookPayload,
  GithubPullRequestWebhookPayload,
  GithubPushWebhookPayload,
} from './github-webhook.types'

type CheckTarget = {
  repoFullName: string
  branch: string | null
  sha: string | null
}

const HANDLED_EVENTS = new Set(['pull_request', 'check_suite', 'check_run', 'push', 'ping'])

@Injectable()
export class GithubDeliveryService {
  private readonly logger = new Logger(GithubDeliveryService.name)

  constructor(
    private readonly github: GithubService,
    private readonly reads: GithubUserReads,
    private readonly fanout: GithubPrFanoutService,
    private readonly cipher: SecretCipherService,
  ) {}

  async handle(args: { event: string; payload: unknown }): Promise<{ handled: boolean }> {
    if (!HANDLED_EVENTS.has(args.event)) return { handled: false }
    if (args.event === 'ping') return { handled: true }

    if (args.event === 'pull_request') {
      await this.handlePullRequest(args.payload as GithubPullRequestWebhookPayload)
      return { handled: true }
    }

    const target = checkTargetOf({ event: args.event, payload: args.payload })
    if (target !== null) await this.handleCheckTarget(target)
    return { handled: true }
  }

  private async handlePullRequest(payload: GithubPullRequestWebhookPayload): Promise<void> {
    const repoFullName = payload.repository.full_name
    const prNumber = payload.pull_request.number
    const fields = payloadFieldsOf({ pull: payload.pull_request })

    const token = await this.findFillToken({ repoFullName })
    if (token !== undefined) {
      const [owner, repo] = repoFullName.split('/') as [string, string]
      const rest = await this.tryRestFill({ token, owner, repo, prNumber })
      if (rest !== null) {
        await this.recordAndPush({ repoFullName, prNumber, fields: rest })
        return
      }
    }

    await this.recordAndPush({ repoFullName, prNumber, fields })
  }

  private async handleCheckTarget(target: CheckTarget): Promise<void> {
    const affected = await this.affectedPrNumbers(target)
    if (affected.length === 0) return

    const token = await this.findFillToken({ repoFullName: target.repoFullName })
    if (token === undefined) return

    const [owner, repo] = target.repoFullName.split('/') as [string, string]
    for (const prNumber of affected) {
      const rest = await this.tryRestFill({ token, owner, repo, prNumber })
      if (rest === null) continue
      await this.recordAndPush({ repoFullName: target.repoFullName, prNumber, fields: rest })
    }
  }

  private async affectedPrNumbers(target: CheckTarget): Promise<number[]> {
    const open = { repoFullName: target.repoFullName, state: { in: ['open', 'draft'] } }
    const byBranch =
      target.branch === null
        ? []
        : await db.githubPrState.findMany({ where: { ...open, headBranch: target.branch } })
    const bySha =
      target.sha === null
        ? []
        : await db.githubPrState.findMany({ where: { ...open, headSha: target.sha } })

    const numbers = new Set<number>()
    for (const row of [...byBranch, ...bySha]) numbers.add(row.prNumber)
    return [...numbers]
  }

  private async findFillToken(args: { repoFullName: string }): Promise<string | undefined> {
    const hook = await db.githubRepoHook.findUnique({
      where: { repoFullName: args.repoFullName },
    })
    if (hook !== null) {
      const createdByToken = await this.github.findToken({ userId: hook.createdBy })
      if (createdByToken !== undefined) return createdByToken
    }

    const subscribers = await db.githubSubscription.findMany({
      where: { repoFullName: args.repoFullName, expiresAt: { gt: new Date() } },
    })
    for (const subscriber of subscribers) {
      const token = await this.github.findToken({ userId: subscriber.userId })
      if (token !== undefined) return token
    }
    return undefined
  }

  private async tryRestFill(args: {
    token: string
    owner: string
    repo: string
    prNumber: number
  }): Promise<(GithubPrStateFields & { updatedAt: Date }) | null> {
    try {
      const fields = await this.reads.readPullRequest({
        token: args.token,
        owner: args.owner,
        repo: args.repo,
        number: args.prNumber,
      })
      return { ...fields, updatedAt: new Date() }
    } catch (failure) {
      if (failure instanceof GithubUserReadFailed && (failure.status === 401 || failure.status === 404)) {
        return null
      }
      throw failure
    }
  }

  private async recordAndPush(args: {
    repoFullName: string
    prNumber: number
    fields: GithubPrStateFields & { updatedAt: Date }
  }): Promise<void> {
    const row = await db.githubPrState.upsert({
      where: {
        repoFullName_prNumber: { repoFullName: args.repoFullName, prNumber: args.prNumber },
      },
      create: { repoFullName: args.repoFullName, prNumber: args.prNumber, ...args.fields },
      update: args.fields,
    })

    const subscribers = await db.githubSubscription.findMany({
      where: { repoFullName: args.repoFullName, prNumber: args.prNumber, expiresAt: { gt: new Date() } },
    })
    if (subscribers.length === 0) return

    const state = dtoOf(row)
    this.fanout.push({ userIds: subscribers.map((row) => row.userId), state })
  }
}

export function dtoOf(row: {
  repoFullName: string
  prNumber: number
  title: string
  url: string
  state: string
  headBranch: string
  headSha: string
  checksRunning: number
  checksPassed: number
  checksFailed: number
  mergeable: boolean | null
  updatedAt: Date
}): GithubPrStateDto {
  return {
    repoFullName: row.repoFullName,
    prNumber: row.prNumber,
    title: row.title,
    url: row.url,
    state: row.state,
    headBranch: row.headBranch,
    headSha: row.headSha,
    checksRunning: row.checksRunning,
    checksPassed: row.checksPassed,
    checksFailed: row.checksFailed,
    mergeable: row.mergeable,
    updatedAt: row.updatedAt.toISOString(),
  }
}

function checkTargetOf(args: { event: string; payload: unknown }): CheckTarget | null {
  if (args.event === 'check_suite') {
    const payload = args.payload as GithubCheckSuiteWebhookPayload
    return {
      repoFullName: payload.repository.full_name,
      branch: payload.check_suite.head_branch,
      sha: payload.check_suite.head_sha,
    }
  }
  if (args.event === 'check_run') {
    const payload = args.payload as GithubCheckRunWebhookPayload
    return {
      repoFullName: payload.repository.full_name,
      branch: payload.check_run.check_suite?.head_branch ?? null,
      sha: payload.check_run.head_sha,
    }
  }
  if (args.event === 'push') {
    const payload = args.payload as GithubPushWebhookPayload
    const branch = payload.ref.replace(/^refs\/heads\//, '')
    if (branch === payload.ref) return null
    return { repoFullName: payload.repository.full_name, branch, sha: null }
  }
  return null
}
