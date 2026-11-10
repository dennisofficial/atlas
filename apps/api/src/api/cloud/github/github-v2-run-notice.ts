import { runEventContent } from '@dltech/atlas-core'
import { postInboxEntryIn } from '@dltech/atlas-control/postgres'
import type { Row, Tx } from '@dltech/atlas-db'
import { INBOX_KIND_MESSAGE, inboxMessageSchema } from '@dltech/atlas-protocol'

import type { WorkflowRunSnapshot } from './github-run-snapshot'

export const runNoticeText = (args: { repoFullName: string; run: WorkflowRunSnapshot }): string =>
  runEventContent({
    type: 'run-event',
    repo: args.repoFullName,
    workflowRunId: Number(args.run.id),
    workflow: args.run.name,
    branch: args.run.headBranch,
    url: args.run.url,
    status: args.run.status,
    conclusion: args.run.conclusion ?? '',
    failedJobs: args.run.failedJobs,
  })

export async function postRunNoticeV2Sessions(args: {
  tx: Tx
  subscription: Row<'GithubSubscription'>
  run: WorkflowRunSnapshot
}): Promise<boolean> {
  const { tx, subscription } = args
  if (subscription.threadId === '') return false
  const thread = await tx.orm.v2.V2Thread.where({ id: subscription.threadId }).first()
  if (thread === null) return false
  const payload = JSON.stringify(
    inboxMessageSchema.parse({
      text: runNoticeText({ repoFullName: subscription.repoFullName, run: args.run }),
    }),
  )
  await postInboxEntryIn({
    tx,
    sessionId: thread.sessionId,
    kind: INBOX_KIND_MESSAGE,
    payload,
    at: new Date().toISOString(),
  })
  return true
}
