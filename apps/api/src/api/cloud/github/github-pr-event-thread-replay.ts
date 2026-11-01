import { db, type Row } from '@dltech/atlas-db'
import { PARK_WAKE_WINDOW_MS } from './github-delivery-routing'
import { eventDtoOf } from './github-pr-event-mailbox.service'
import { teammateThreadIds } from '../../platform/sessions/thread-subscriptions'
import type { GithubPrEventDto } from './github-realtime.types'

type ThreadReplay = { threadId: string; events: GithubPrEventDto[] }

/**
 * The events the thread family's PR subscriptions saw while it had no stream, grouped per linked
 * thread. A subscription row is owned by one thread (a teammate's subscription is its own row),
 * so replay enumerates the links of the authenticated thread AND its teammate children and claims
 * (eventId, threadId) per owning thread — a row another stream already claimed is skipped, so a
 * racing replay or an earlier live push never delivers the same event twice.
 */
export async function replayThreadEvents(args: {
  userId: string
  threadId: string
}): Promise<GithubPrEventDto[]> {
  const grouped = await replayThreadEventsGrouped(args)
  return grouped.flatMap((replay) => replay.events)
}

export async function replayThreadEventsGrouped(args: {
  userId: string
  threadId: string
}): Promise<ThreadReplay[]> {
  const teammates = await teammateThreadIds({ reader: db, threadIds: [args.threadId] })
  const threadIds = [args.threadId, ...(teammates.get(args.threadId) ?? [])]
  const subscriptions = await db.orm.public.GithubSubscription.where({ userId: args.userId })
    .where((subscription) => subscription.threadId.in(threadIds))
    .all()

  const windowStart = Date.now() - PARK_WAKE_WINDOW_MS
  const replays: ThreadReplay[] = []
  for (const threadId of threadIds) {
    const events = await replayLinked({
      userId: args.userId,
      threadId,
      subscriptions: subscriptions.filter(
        (subscription) => subscription.threadId === threadId && subscription.prNumber !== null,
      ),
      windowStart,
    })
    if (events.length > 0) replays.push({ threadId, events })
  }
  return replays
}

async function replayLinked(args: {
  userId: string
  threadId: string
  subscriptions: Row<'GithubSubscription'>[]
  windowStart: number
}): Promise<GithubPrEventDto[]> {
  const candidates: Row<'GithubPrEvent'>[] = []
  for (const subscription of args.subscriptions) {
    if (subscription.prNumber === null) continue
    const since = new Date(Math.max(subscription.createdAt.getTime(), args.windowStart))
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
