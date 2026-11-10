import { Logger } from '@nestjs/common'
import { postInboxEntryIn } from '@dltech/atlas-control/postgres'
import { db } from '@dltech/atlas-db'
import { INBOX_KIND_MESSAGE, inboxMessageSchema } from '@dltech/atlas-protocol'

import { branchRoutingOf, subscriberWhereOf } from './github-delivery-routing'
import { repoPattern } from './github-pr-identity'
import type { GithubMergeQueueEntryWebhookPayload } from './github-webhook.types'

const logger = new Logger('GithubMergeQueueWebhook')

const QUEUED_PR_IN_HEAD_REF = /\/pr-(\d+)-/

const verbOf = (action: string): string | null => {
  if (action === 'added') return 'entered'
  if (action === 'removed') return 'left'
  return null
}

/** A `removed` delivery may carry no `pull_request`; the queue head ref still names the PR. */
export function mergeQueuePrNumberOf(payload: GithubMergeQueueEntryWebhookPayload): number | null {
  const stated = payload.pull_request?.number
  if (stated !== undefined) return stated
  const match = QUEUED_PR_IN_HEAD_REF.exec(payload.merge_group?.head_ref ?? '')
  if (match === null) return null
  const number = Number(match[1])
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

export const mergeQueueNoticeText = (args: { prNumber: number; verb: string }): string =>
  `#${args.prNumber} ${args.verb} the merge queue`

async function subscribedThreadIds(args: {
  repoFullName: string
  prNumber: number
}): Promise<string[]> {
  const state = await db.orm.public.GithubPrState.where((pr) =>
    pr.repoFullName.ilike(repoPattern(args.repoFullName)),
  )
    .where({ prNumber: args.prNumber })
    .first()
  if (state === null) return []
  const subscriptions = await db.orm.public.GithubSubscription.where(
    subscriberWhereOf({
      repoFullName: args.repoFullName,
      prNumber: args.prNumber,
      routing: branchRoutingOf({
        baseRepoFullName: args.repoFullName,
        headBranch: state.headBranch,
        headRepoFullName: state.headRepoFullName,
      }),
    }),
  )
    .where((subscription) => subscription.threadId.neq(''))
    .all()
  return [...new Set(subscriptions.map((subscription) => subscription.threadId))]
}

export async function recordMergeQueueEntry(args: {
  payload: GithubMergeQueueEntryWebhookPayload
}): Promise<number> {
  const verb = verbOf(args.payload.action)
  if (verb === null) return 0
  const prNumber = mergeQueuePrNumberOf(args.payload)
  if (prNumber === null) return 0
  const repoFullName = args.payload.repository.full_name
  const threadIds = await subscribedThreadIds({ repoFullName, prNumber })
  if (threadIds.length === 0) return 0
  const threads = await db.orm.v2.V2Thread.where((thread) => thread.id.in(threadIds)).all()
  if (threads.length === 0) return 0
  const payload = JSON.stringify(
    inboxMessageSchema.parse({ text: mergeQueueNoticeText({ prNumber, verb }) }),
  )
  const at = new Date().toISOString()
  await db.transaction(async (tx) => {
    for (const thread of threads) {
      await postInboxEntryIn({
        tx,
        sessionId: thread.sessionId,
        kind: INBOX_KIND_MESSAGE,
        payload,
        at,
      })
    }
  })
  logger.log(
    `notified ${threads.length} thread(s) that ${repoFullName}#${prNumber} ${verb} the merge queue`,
  )
  return threads.length
}
