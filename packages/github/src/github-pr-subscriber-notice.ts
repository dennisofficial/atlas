import { INBOX_KIND_EVENT } from '@dltech/atlas-core'
import { postInboxEntryIn } from '@dltech/atlas-control/postgres'
import { db } from '@dltech/atlas-db'

import { branchRoutingOf, subscriberWhereOf } from './github-delivery-routing'
import { githubLogOf } from './github-log'
import { repoPattern } from './github-pr-identity'

const logger = githubLogOf('GithubPrSubscriberNotice')

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

export async function notifyPrSubscribers(args: {
  repoFullName: string
  prNumber: number
  payload: string
  what: string
}): Promise<number> {
  const { repoFullName, prNumber, payload, what } = args
  const threadIds = await subscribedThreadIds({ repoFullName, prNumber })
  if (threadIds.length === 0) return 0
  const threads = await db.orm.public.Thread.where((thread) => thread.id.in(threadIds)).all()
  if (threads.length === 0) return 0
  const at = new Date().toISOString()
  await db.transaction(async (tx) => {
    for (const thread of threads) {
      await postInboxEntryIn({
        tx,
        sessionId: thread.sessionId,
        kind: INBOX_KIND_EVENT,
        payload,
        at,
      })
    }
  })
  logger.log(`notified ${threads.length} thread(s) that ${repoFullName}#${prNumber} ${what}`)
  return threads.length
}
