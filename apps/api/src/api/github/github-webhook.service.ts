import { Injectable, Logger } from '@nestjs/common'
import { isUniqueViolation } from '../factory/unique-violation'
import { db } from '../../db'
import { GithubInstallationReads } from './github-installation-reads'
import type {
  GithubPrWebhookOutcome,
  GithubPullRequestWebhookPayload,
} from './github-webhook.types'

type NormalizedDelivery = {
  repoFullName: string | null
  prNumber: number | null
  branch: string | null
}

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

    return {
      handled: args.event === 'pull_request' || args.event === 'ping',
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
  if (args.event === 'push') {
    return { repoFullName, prNumber: null, branch: payload.ref?.replace(/^refs\/heads\//, '') ?? null }
  }
  return { repoFullName, prNumber: null, branch: null }
}
