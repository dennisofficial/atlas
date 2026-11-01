import { Injectable, Logger } from '@nestjs/common'
import { db } from '@dltech/atlas-db'

import {
  PrSubscriptionLinks,
  type PrSubscriptionLinkEventRow,
} from '../../../_core/ports/pr-subscription-links'
import { PULL_REQUEST_PROVIDER_KIND } from '../../platform/sessions/thread-subscriptions'
import { liveUntilOf, nextExpiry } from './github-delivery-routing'
import { GithubSubscriptionsService } from './github-subscriptions.service'
import { threadActivityAt } from './github-thread-activity'

type PrTarget = { repoFullName: string; prNumber: number }

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
    const created = args.events.filter((event) => event.type === 'subscription-created')
    if (created.length === 0) return
    const existing = await db.orm.public.GithubSubscription.where({
      userId: args.userId,
      threadId: args.threadId,
    })
      .select('id', 'repoFullName', 'branch')
      .all()
    for (const event of created) {
      const target = prTargetOf(event.body)
      if (target === null) continue
      const branch = `#${target.prNumber}`
      const known = existing.some(
        (row) => row.repoFullName === target.repoFullName && row.branch === branch,
      )
      await this.ensureLink({ userId: args.userId, threadId: args.threadId, target, branch })
      if (!known) {
        await db.orm.public.GithubRepoHook.where({
          repoFullName: target.repoFullName,
        }).updateAndCount({ idleSince: null })
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
      repos.add(link.repoFullName)
    }
    for (const repoFullName of repos) {
      await this.subscriptions.markIdleWhenDrained({ repoFullName })
    }
  }

  private async ensureLink(args: {
    userId: string
    threadId: string
    target: PrTarget
    branch: string
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
          branch: args.branch,
        },
        create: {
          userId: args.userId,
          repoFullName: args.target.repoFullName,
          prNumber: args.target.prNumber,
          branch: args.branch,
          pollBacked: true,
          expiresAt,
          liveUntil,
          threadId: args.threadId,
        },
        update: {
          prNumber: args.target.prNumber,
          threadId: args.threadId,
          expiresAt,
          liveUntil,
        },
      })
    } catch (failure) {
      this.logger.warn(
        `linking ${args.target.repoFullName}#${args.target.prNumber} to thread ${args.threadId} failed: ${failureText(failure)}`,
      )
    }
  }
}

const GITHUB_PREFIX = 'github.com/'

/** Mirrors the harness provider's target parse: repo is `github.com/owner/name`. */
export function prTargetOf(body: string): PrTarget | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const target = (parsed as Record<string, unknown>).target
  if (typeof target !== 'object' || target === null || Array.isArray(target)) return null
  const repo = (target as Record<string, unknown>).repo
  const number = (target as Record<string, unknown>).number
  if (typeof repo !== 'string' || typeof number !== 'number' || !Number.isInteger(number)) {
    return null
  }
  if ((parsed as Record<string, unknown>).provider !== PULL_REQUEST_PROVIDER_KIND) return null
  const repoFullName = repo.startsWith(GITHUB_PREFIX) ? repo.slice(GITHUB_PREFIX.length) : repo
  return { repoFullName, prNumber: number }
}
