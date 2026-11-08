import { postInboxEntryIn } from '@dltech/atlas-control/postgres'
import type { Row, Tx } from '@dltech/atlas-db'
import { INBOX_KIND_MESSAGE, inboxMessageSchema } from '@dltech/atlas-protocol'
import { subscriptionLiveWhere } from './github-delivery-routing'
import { repoPattern } from './github-pr-identity'
import type { EPrEventKind, GithubPrEventPayload } from './github-realtime.types'
import { v2NoticeText } from './github-v2-notice-text'

const subscribedV2Sessions = async (args: {
  tx: Tx
  event: Row<'GithubPrEvent'>
  now: Date
}): Promise<Array<{ threadId: string; sessionId: string }>> => {
  const { tx, event } = args
  const subscriptions = await tx.orm.public.GithubSubscription.where({
    userId: event.userId,
    prNumber: event.prNumber,
  })
    .where((subscription) => subscription.repoFullName.ilike(repoPattern(event.repoFullName)))
    .where((subscription) => subscription.threadId.neq(''))
    .where(subscriptionLiveWhere({ now: args.now }))
    .all()
  if (subscriptions.length === 0) return []
  const threadIds = [...new Set(subscriptions.map((subscription) => subscription.threadId))]
  const threads = await tx.orm.v2.V2Thread.where((thread) => thread.id.in(threadIds)).all()
  return threads.map((thread) => ({
    threadId: thread.id,
    sessionId: thread.sessionId,
  }))
}

export async function noticeV2Sessions(args: {
  tx: Tx
  event: Row<'GithubPrEvent'>
}): Promise<number> {
  const { tx, event } = args
  const at = new Date()
  const targets = await subscribedV2Sessions({ tx, event, now: at })
  if (targets.length === 0) return 0
  const state = await tx.orm.public.GithubPrState.where({
    repoFullName: event.repoFullName,
    prNumber: event.prNumber,
  }).first()
  const text = v2NoticeText({
    kind: event.kind as EPrEventKind,
    prNumber: event.prNumber,
    payload: event.payload as GithubPrEventPayload,
    tally: state,
  })
  const payload = JSON.stringify(inboxMessageSchema.parse({ text }))
  let posted = 0
  for (const target of targets) {
    const claimed = await tx.orm.public.GithubPrEventDelivery.createAndCount(
      [
        {
          eventId: event.id,
          threadId: target.threadId,
          ackedAt: at,
          leaseExpiresAt: null,
        },
      ],
      { onConflict: 'skip' },
    )
    if (claimed === 0) continue
    await postInboxEntryIn({
      tx,
      sessionId: target.sessionId,
      kind: INBOX_KIND_MESSAGE,
      payload,
      at: at.toISOString(),
    })
    posted += 1
  }
  return posted
}
