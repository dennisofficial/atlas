import {
  INBOX_KIND_EVENT,
  inboxEventPayloadOf,
  ESubscriptionActor,
  ESubscriptionEnd,
} from '@dltech/atlas-core'
import { controlTxOf, postInboxEntryIn } from '@dltech/atlas-control/postgres'
import { endSubscriptionsIn } from '@dltech/atlas-control'
import type { Row, Tx } from '@dltech/atlas-db'

import { runSelectorOf } from './github-run-selector'
import type { WorkflowRunSnapshot } from './github-run-snapshot'

const pinnedToRun = (subscription: Row<'GithubSubscription'>): boolean =>
  runSelectorOf(subscription.branch)?.selector === 'run'

export async function postRunNoticeV2Sessions(args: {
  tx: Tx
  subscription: Row<'GithubSubscription'>
  run: WorkflowRunSnapshot
}): Promise<boolean> {
  const { tx, subscription } = args
  if (subscription.threadId === '') return false
  const thread = await tx.orm.v2.V2Thread.where({ id: subscription.threadId }).first()
  if (thread === null) return false
  const at = new Date()
  const payload = inboxEventPayloadOf({
    event: {
      type: 'run-event',
      repo: subscription.repoFullName,
      workflowRunId: Number(args.run.id),
      workflow: args.run.name,
      branch: args.run.headBranch,
      url: args.run.url,
      status: args.run.status,
      conclusion: args.run.conclusion ?? '',
      failedJobs: args.run.failedJobs,
    },
  })
  await postInboxEntryIn({
    tx,
    sessionId: thread.sessionId,
    kind: INBOX_KIND_EVENT,
    payload,
    at: at.toISOString(),
  })
  if (pinnedToRun(subscription))
    await endSubscriptionsIn({
      tx: controlTxOf(tx),
      rows: [{ subscriptionId: subscription.id, threadId: subscription.threadId }],
      by: ESubscriptionActor.Provider,
      reason: ESubscriptionEnd.Completed,
      at: at.toISOString(),
    })
  return true
}
