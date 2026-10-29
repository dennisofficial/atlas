import { db } from '@dltech/atlas-db'
import { PARK_WAKE_WINDOW_MS } from './github-delivery-routing'
import { eventDtoOf } from './github-pr-event-mailbox.service'
import type { GithubPrEventDto } from './github-realtime.types'

/**
 * The events a thread's own PR subscriptions saw while it had no stream, oldest first. Each is
 * claimed by inserting its delivery row; a row another stream already claimed is skipped, so a
 * racing replay or an earlier live push never delivers the same event to the thread twice.
 */
export async function replayThreadEvents(args: {
  userId: string
  threadId: string
}): Promise<GithubPrEventDto[]> {
  const subscriptions = await db.orm.public.GithubSubscription.where({
    userId: args.userId,
    threadId: args.threadId,
  }).all()
  const windowStart = Date.now() - PARK_WAKE_WINDOW_MS
  const candidates = []
  for (const subscription of subscriptions) {
    if (subscription.prNumber === null) continue
    const since = new Date(Math.max(subscription.createdAt.getTime(), windowStart))
    const rows = await db.orm.public.GithubPrEvent.where({
      userId: args.userId,
      repoFullName: subscription.repoFullName,
      prNumber: subscription.prNumber,
    })
      .where((event) => event.createdAt.gte(since))
      .all()
    candidates.push(...rows)
  }
  if (candidates.length === 0) return []

  const claimed = await db.orm.public.GithubPrEventDelivery.createAll(
    candidates.map((row) => ({ eventId: row.id, threadId: args.threadId })),
    { onConflict: 'skip' },
  )
  const claimedIds = new Set(claimed.map((row) => row.eventId))
  return candidates
    .filter((row) => claimedIds.has(row.id))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map(eventDtoOf)
}
