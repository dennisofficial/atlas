import { Injectable, Logger } from '@nestjs/common'
import { isUniqueViolation } from '../../factory/unique-violation'
import { db } from '../../../db'
import { GithubInstallationReads } from './github-installation-reads'
import { OPEN_STATES } from './pull-requests.service'
import type {
  GithubCheckRunWebhookPayload,
  GithubCheckSuiteWebhookPayload,
  GithubPrWebhookOutcome,
  GithubPullRequestWebhookPayload,
  GithubPushWebhookPayload,
} from './github-webhook.types'

type NormalizedDelivery = {
  repoFullName: string | null
  prNumber: number | null
  branch: string | null
}

type CheckSyncTarget = {
  repoFullName: string
  branch: string | null
  sha: string | null
}

const HANDLED_EVENTS = new Set(['pull_request', 'check_suite', 'check_run', 'push', 'ping'])

const CHECK_SYNC_EVENTS = new Set(['check_suite', 'check_run', 'push'])

const REFRESH_FLOOR_MS = 15_000

@Injectable()
export class GithubPrWebhookService {
  private readonly logger = new Logger(GithubPrWebhookService.name)

  constructor(private readonly reads: GithubInstallationReads) {}

  async handle(args: {
    event: string
    deliveryId: string
    payload: unknown
  }): Promise<GithubPrWebhookOutcome> {
    const normalized = normalize({ event: args.event, payload: args.payload })
    const persisted = await this.persist({ ...args, normalized })

    if (args.event === 'pull_request') {
      await this.syncPullRequest(args.payload as GithubPullRequestWebhookPayload)
    }
    if (CHECK_SYNC_EVENTS.has(args.event)) {
      await this.syncCheckAffected({ event: args.event, payload: args.payload })
    }

    return {
      handled: HANDLED_EVENTS.has(args.event),
      event: args.event,
      persisted,
    }
  }

  private async persist(args: {
    event: string
    deliveryId: string
    payload: unknown
    normalized: NormalizedDelivery
  }): Promise<boolean> {
    try {
      await db.githubWebhookEvent.create({
        data: {
          id: args.deliveryId,
          event: args.event,
          repoFullName: args.normalized.repoFullName ?? '',
          prNumber: args.normalized.prNumber,
          branch: args.normalized.branch,
          payload: JSON.stringify(args.payload),
        },
      })
      return true
    } catch (failure) {
      if (isUniqueViolation(failure, ['id'])) return false
      throw failure
    }
  }

  private async syncCheckAffected(args: { event: string; payload: unknown }): Promise<void> {
    const target = checkTargetOf(args)
    if (target === null) return

    const [owner, repo] = target.repoFullName.split('/')
    if (owner === undefined || repo === undefined) return

    const affected = await affectedPullRequests({ target, now: Date.now() })
    for (const number of affected) {
      const fields = await this.reads.readPullRequest({ owner, repo, number })
      await db.githubPullRequest.upsert({
        where: { repoFullName_number: { repoFullName: target.repoFullName, number } },
        create: { repoFullName: target.repoFullName, number, ...fields },
        update: fields,
      })
    }
  }

  private async syncPullRequest(payload: GithubPullRequestWebhookPayload): Promise<void> {
    const [owner, repo] = payload.repository.full_name.split('/')
    if (owner === undefined || repo === undefined) return

    const fields = await this.reads.readPullRequest({
      owner,
      repo,
      number: payload.pull_request.number,
    })
    await db.githubPullRequest.upsert({
      where: {
        repoFullName_number: { repoFullName: payload.repository.full_name, number: payload.pull_request.number },
      },
      create: {
        repoFullName: payload.repository.full_name,
        number: payload.pull_request.number,
        ...fields,
      },
      update: fields,
    })
  }
}

function normalize(args: { event: string; payload: unknown }): NormalizedDelivery {
  const payload = args.payload as {
    repository?: { full_name?: string }
    pull_request?: { number?: number; head?: { ref?: string } }
    check_suite?: { head_branch?: string | null }
    check_run?: { check_suite?: { head_branch?: string | null } }
    ref?: string
  }
  const repoFullName = payload.repository?.full_name ?? null

  if (args.event === 'pull_request') {
    return {
      repoFullName,
      prNumber: payload.pull_request?.number ?? null,
      branch: payload.pull_request?.head?.ref ?? null,
    }
  }
  if (args.event === 'check_suite') {
    return { repoFullName, prNumber: null, branch: payload.check_suite?.head_branch ?? null }
  }
  if (args.event === 'check_run') {
    return { repoFullName, prNumber: null, branch: payload.check_run?.check_suite?.head_branch ?? null }
  }
  if (args.event === 'push') {
    return { repoFullName, prNumber: null, branch: payload.ref?.replace(/^refs\/heads\//, '') ?? null }
  }
  return { repoFullName, prNumber: null, branch: null }
}

function checkTargetOf(args: { event: string; payload: unknown }): CheckSyncTarget | null {
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

async function affectedPullRequests(args: {
  target: CheckSyncTarget
  now: number
}): Promise<readonly number[]> {
  const fresh = args.now - REFRESH_FLOOR_MS
  const open = { repoFullName: args.target.repoFullName, state: { in: OPEN_STATES } }

  const byBranch =
    args.target.branch === null
      ? []
      : await db.githubPullRequest.findMany({
          where: { ...open, headBranch: args.target.branch, updatedAt: { lt: new Date(fresh) } },
        })
  const bySha =
    args.target.sha === null
      ? []
      : await db.githubPullRequest.findMany({
          where: { ...open, headSha: args.target.sha, updatedAt: { lt: new Date(fresh) } },
        })

  const numbers = new Set<number>()
  for (const row of [...byBranch, ...bySha]) numbers.add(row.number)
  return [...numbers]
}
