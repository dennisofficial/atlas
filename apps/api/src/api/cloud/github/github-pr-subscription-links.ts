import { Injectable, Logger } from '@nestjs/common'
import { db } from '@dltech/atlas-db'

import {
  PrSubscriptionLinks,
  type PrSubscriptionLinkEventRow,
} from '../../../_core/ports/pr-subscription-links'
import {
  GITHUB_WORKFLOW_RUN_PROVIDER_KIND,
  PULL_REQUEST_PROVIDER_KIND,
} from '../../platform/sessions/thread-subscriptions'
import { liveUntilOf, nextExpiry } from './github-delivery-routing'
import {
  PULL_REQUEST_KIND,
  WORKFLOW_RUN_KIND,
  runBranchOf,
  workflowBranchOf,
} from './github-run-selector'
import { GithubSubscriptionsService } from './github-subscriptions.service'
import { threadActivityAt } from './github-thread-activity'

type LinkTarget = {
  repoFullName: string
  branch: string
  kind: string
  prNumber: number | null
}

const failureText = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

/**
 * Bridges the harness's conversation-level subscriptions (subscription-created/-changed/-ended
 * events on the thread) to the GithubSubscription rows delivery and the sandbox wake resolve
 * targets from. The row is the same one a sandbox-linked subscribe writes — one table, one set of
 * delivery semantics — so subscriberWhere, the mailbox, the wake and the local-pod fanout all see
 * a conversation subscription without a second read path.
 */
@Injectable()
export class GithubPrSubscriptionLinks extends PrSubscriptionLinks {
  private readonly logger = new Logger(GithubPrSubscriptionLinks.name)

  constructor(private readonly subscriptions: GithubSubscriptionsService) {
    super()
  }

  async syncFromEvents(args: {
    userId: string
    threadId: string
    events: readonly PrSubscriptionLinkEventRow[]
  }): Promise<void> {
    const subscriptionEvents = args.events.filter(
      (event) => event.type === 'subscription-created' || event.type === 'subscription-ended',
    )
    if (subscriptionEvents.length === 0) return
    const existing = await db.orm.public.GithubSubscription.where({
      userId: args.userId,
      threadId: args.threadId,
    })
      .select('id', 'repoFullName', 'branch')
      .all()
    for (const event of subscriptionEvents) {
      if (event.type === 'subscription-created') {
        const target = linkTargetOf(event.body)
        if (target === null) continue
        const known = existing.some(
          (row) => row.repoFullName === target.repoFullName && row.branch === target.branch,
        )
        await this.ensureLink({ userId: args.userId, threadId: args.threadId, target })
        if (!known && target.kind === PULL_REQUEST_KIND) {
          await db.orm.public.GithubRepoHook.where({
            repoFullName: target.repoFullName,
          }).updateAndCount({ idleSince: null })
        }
        continue
      }
      const endedTarget = await this.endedTargetOf({
        threadId: args.threadId,
        body: event.body,
      })
      if (endedTarget === null) continue
      const removed = await db.orm.public.GithubSubscription.where({
        userId: args.userId,
        threadId: args.threadId,
        repoFullName: endedTarget.repoFullName,
        branch: endedTarget.branch,
      }).deleteAndCount()
      if (removed > 0 && endedTarget.kind === PULL_REQUEST_KIND) {
        await this.subscriptions.markIdleWhenDrained({ repoFullName: endedTarget.repoFullName })
      }
    }
  }

  async endForThreads(args: {
    userId: string
    threadIds: readonly string[]
    activeTargets: ReadonlyMap<string, readonly { repoFullName: string; prNumber: number }[]>
  }): Promise<void> {
    if (args.threadIds.length === 0) return
    const links = await db.orm.public.GithubSubscription.where((row) =>
      row.threadId.in([...args.threadIds]),
    ).all()
    const repos = new Set<string>()
    for (const link of links) {
      const kept = (args.activeTargets.get(link.threadId ?? '') ?? []).some(
        (target) => target.repoFullName === link.repoFullName && target.prNumber === link.prNumber,
      )
      if (kept) continue
      await db.orm.public.GithubSubscription.where({ id: link.id }).delete()
      if (link.kind === PULL_REQUEST_KIND) repos.add(link.repoFullName)
    }
    for (const repoFullName of repos) {
      await this.subscriptions.markIdleWhenDrained({ repoFullName })
    }
  }

  private async endedTargetOf(args: {
    threadId: string
    body: string
  }): Promise<LinkTarget | null> {
    const subscriptionId = subscriptionIdOf(args.body)
    if (subscriptionId === undefined) return null
    const marker = `"subscriptionId":${JSON.stringify(subscriptionId)}`
    const created = await db.orm.public.Event.where({ threadId: args.threadId })
      .select('body')
      .all()
    for (const row of created) {
      if (!row.body.includes(marker)) continue
      const target = linkTargetOf(row.body)
      if (target !== null) return target
    }
    return null
  }

  private async ensureLink(args: {
    userId: string
    threadId: string
    target: LinkTarget
  }): Promise<void> {
    try {
      const expiresAt = nextExpiry()
      const activity = await threadActivityAt({ threadIds: [args.threadId] })
      const liveUntil = liveUntilOf({
        expiresAt,
        sandboxLastActivityAt: activity.get(args.threadId) ?? null,
      })
      await db.orm.public.GithubSubscription.upsert({
        conflictOn: {
          userId: args.userId,
          repoFullName: args.target.repoFullName,
          branch: args.target.branch,
          threadId: args.threadId,
        },
        create: {
          userId: args.userId,
          repoFullName: args.target.repoFullName,
          prNumber: args.target.prNumber,
          branch: args.target.branch,
          kind: args.target.kind,
          pollBacked: true,
          expiresAt,
          liveUntil,
          threadId: args.threadId,
        },
        update: {
          prNumber: args.target.prNumber,
          expiresAt,
          liveUntil,
        },
      })
    } catch (failure) {
      this.logger.warn(
        `linking ${args.target.repoFullName} ${args.target.branch} to thread ${args.threadId} failed: ${failureText(failure)}`,
      )
    }
  }
}

function subscriptionIdOf(body: string): string | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  const subscriptionId = (parsed as Record<string, unknown>).subscriptionId
  return typeof subscriptionId === 'string' ? subscriptionId : undefined
}

const GITHUB_PREFIX = 'github.com/'

function targetFieldsOf(
  body: string,
): { provider: string; target: Record<string, unknown> } | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  const provider = record.provider
  const target = record.target
  if (typeof provider !== 'string') return null
  if (typeof target !== 'object' || target === null || Array.isArray(target)) return null
  return { provider, target: target as Record<string, unknown> }
}

function repoOf(target: Record<string, unknown>): string | null {
  const repo = target.repo
  if (typeof repo !== 'string' || repo === '') return null
  return repo.startsWith(GITHUB_PREFIX) ? repo.slice(GITHUB_PREFIX.length) : repo
}

/** A pull-request target is a number; the row's branch is that number's discriminator. */
export function prTargetOf(body: string): LinkTarget | null {
  const fields = targetFieldsOf(body)
  if (fields === null || fields.provider !== PULL_REQUEST_PROVIDER_KIND) return null
  const repoFullName = repoOf(fields.target)
  const number = fields.target.number
  if (repoFullName === null || typeof number !== 'number' || !Number.isInteger(number)) return null
  return { repoFullName, branch: `#${number}`, kind: PULL_REQUEST_KIND, prNumber: number }
}

/** A run target is either a pinned run id or a workflow+branch selector for the next run. */
export function runTargetOf(body: string): LinkTarget | null {
  const fields = targetFieldsOf(body)
  if (fields === null || fields.provider !== GITHUB_WORKFLOW_RUN_PROVIDER_KIND) return null
  const repoFullName = repoOf(fields.target)
  if (repoFullName === null) return null
  const runId = fields.target.runId
  if (typeof runId === 'number' && Number.isInteger(runId)) {
    return {
      repoFullName,
      branch: runBranchOf({ runId }),
      kind: WORKFLOW_RUN_KIND,
      prNumber: null,
    }
  }
  const workflow = fields.target.workflow
  const branch = fields.target.branch
  if (typeof workflow !== 'string' || workflow === '') return null
  if (typeof branch !== 'string' || branch === '') return null
  return {
    repoFullName,
    branch: workflowBranchOf({ workflow, branch }),
    kind: WORKFLOW_RUN_KIND,
    prNumber: null,
  }
}

export function linkTargetOf(body: string): LinkTarget | null {
  return prTargetOf(body) ?? runTargetOf(body)
}
