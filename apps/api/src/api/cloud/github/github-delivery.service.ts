import { Injectable, Logger } from '@nestjs/common'
import { db, type GithubPrStateModel } from '../../../db'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import { payloadFieldsOf } from './github-pr-payload'
import { carryChecks, provisionalFieldsOf, stateFieldsOf, type CheckTarget } from './github-pr-state-fields'
import type {
  GithubBranchRouting,
  GithubPrStateDto,
  GithubPrStateRecord,
} from './github-realtime.types'
import { GithubUserReadFailed, GithubUserReads } from './github-user-reads'
import { GithubService } from './github.service'
import type {
  GithubCheckRunWebhookPayload,
  GithubCheckSuiteWebhookPayload,
  GithubPullRequestWebhookPayload,
  GithubPushWebhookPayload,
} from './github-webhook.types'

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
    const [prior, token] = await Promise.all([
      db.githubPrState.findUnique({ where: { repoFullName_prNumber: { repoFullName, prNumber } } }),
      this.findFillToken({ repoFullName }),
    ])

    const payloadFields = payloadFieldsOf({ pull: payload.pull_request })
    const recordPayload = this.recordAndPush({
      repoFullName,
      prNumber,
      fields: carryChecks({ fields: payloadFields, prior: prior === null ? null : stateFieldsOf(prior) }),
    })

    if (token === undefined) {
      await recordPayload
      return
    }

    const [owner, repo] = repoFullName.split('/') as [string, string]
    const fill = this.tryRestFill({ token, owner, repo, prNumber })
    await recordPayload
    const rest = await fill
    if (rest === null) return
    await this.recordAndPush({ repoFullName, prNumber, fields: rest })
  }

  private async handleCheckTarget(target: CheckTarget): Promise<void> {
    const affected = await this.affectedPrs(target)
    if (affected.length === 0) return

    const token = await this.findFillToken({ repoFullName: target.repoFullName })
    if (token === undefined) return

    const [owner, repo] = target.repoFullName.split('/') as [string, string]
    for (const pr of affected) {
      const fill = this.tryRestFill({ token, owner, repo, prNumber: pr.prNumber })
      await this.recordAndPush({
        repoFullName: target.repoFullName,
        prNumber: pr.prNumber,
        fields: provisionalFieldsOf({ target, prior: stateFieldsOf(pr) }),
      })

      const rest = await fill
      if (rest === null) continue
      await this.recordAndPush({ repoFullName: target.repoFullName, prNumber: pr.prNumber, fields: rest })
    }
  }

  private async affectedPrs(target: CheckTarget): Promise<GithubPrStateModel[]> {
    const open = { repoFullName: target.repoFullName, state: { in: ['open', 'draft'] } }
    const byBranch =
      target.branch === null
        ? []
        : await db.githubPrState.findMany({ where: { ...open, headBranch: target.branch } })
    const bySha =
      target.sha === null
        ? []
        : await db.githubPrState.findMany({ where: { ...open, headSha: target.sha } })

    const prs = new Map<number, GithubPrStateModel>()
    for (const row of [...byBranch, ...bySha]) prs.set(row.prNumber, row)
    return [...prs.values()]
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
  }): Promise<GithubPrStateRecord | null> {
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
      this.logger.warn(`REST fill for ${args.owner}/${args.repo}#${args.prNumber} failed: ${String(failure)}`)
      return null
    }
  }

  private async recordAndPush(args: {
    repoFullName: string
    prNumber: number
    fields: GithubPrStateRecord
  }): Promise<void> {
    const row = await db.githubPrState.upsert({
      where: {
        repoFullName_prNumber: { repoFullName: args.repoFullName, prNumber: args.prNumber },
      },
      create: { repoFullName: args.repoFullName, prNumber: args.prNumber, ...args.fields },
      update: args.fields,
    })

    // Route on the incoming fields rather than the stored row: a row written before the column
    // existed reads NULL (number-routed) even when this delivery knows the head repo, and the
    // fields are never staler than what was just upserted. A delivery that carries no repo
    // (deleted fork, or provisional fields carried forward from an old row) falls back to the
    // row, and NULL stays number-routed — silence over a same-name fork branch leaking frames.
    const subscribers = await db.githubSubscription.findMany({
      where: subscriberWhereOf({
        repoFullName: args.repoFullName,
        prNumber: args.prNumber,
        routing: branchRoutingOf({
          baseRepoFullName: args.repoFullName,
          headBranch: args.fields.headBranch,
          headRepoFullName: args.fields.headRepoFullName ?? row.headRepoFullName,
        }),
      }),
    })
    if (subscribers.length === 0) return

    const state = dtoOf(row)
    this.fanout.push({
      userIds: [...new Set(subscribers.map((subscriber) => subscriber.userId))],
      state,
    })
  }
}

export function subscriberWhereOf(args: {
  repoFullName: string
  prNumber: number
  routing: GithubBranchRouting
}): Record<string, unknown> {
  const live = { expiresAt: { gt: new Date() } }
  const routing = args.routing
  if (!routing.headRepoMatchesBase || routing.headBranch === '') {
    return { repoFullName: args.repoFullName, prNumber: args.prNumber, ...live }
  }
  return {
    repoFullName: args.repoFullName,
    ...live,
    OR: [{ prNumber: args.prNumber }, { branch: { equals: routing.headBranch, not: '' } }],
  }
}

/**
 * A fork-head PR's head.ref is an unqualified branch name, indistinguishable from a same-repo
 * branch, so branch-routing it would fan out to a same-name branch subscriber on the base repo.
 * GitHub nulls head.repo for a deleted fork, and REST rows written before this column existed
 * are null too — both fall to number-routing only, which errs toward silence, never a leak.
 */
function branchRoutingOf(args: {
  baseRepoFullName: string
  headBranch: string
  headRepoFullName: string | null
}): GithubBranchRouting {
  return {
    headBranch: args.headBranch,
    headRepoMatchesBase: args.headRepoFullName === args.baseRepoFullName,
  }
}

export function dtoOf(row: GithubPrStateModel): GithubPrStateDto {
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
