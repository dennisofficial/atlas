import { Logger } from '@nestjs/common'
import { db, type Row } from '@dltech/atlas-db'

import { repoPattern } from './github-pr-identity'
import { WORKFLOW_RUN_KIND, runSelectorOf, type RunSelector } from './github-run-selector'
import type { WorkflowRunSnapshot } from './github-run-snapshot'
import { failureText } from './github-sandbox-wake-boot'
import type { GithubSandboxWakeService } from './github-sandbox-wake.service'
import { postRunNoticeV2Sessions } from './github-v2-run-notice'
import type {
  GithubWorkflowRunWebhookPayload,
  GithubWorkflowRunWebhookRun,
} from './github-webhook.types'

const logger = new Logger('GithubWorkflowRunWebhook')

const basenameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

export function runSnapshotOf(payload: GithubWorkflowRunWebhookPayload): WorkflowRunSnapshot {
  const run = payload.workflow_run
  return {
    id: String(run.id),
    status: run.status ?? '',
    conclusion: run.conclusion ?? null,
    name: run.name ?? '',
    headBranch: run.head_branch ?? '',
    url: run.html_url ?? '',
    failedJobs: (run.jobs ?? [])
      .filter((job) => job.conclusion === 'failure')
      .map((job) => job.name),
  }
}

export function runMatchesSelector(args: {
  selector: RunSelector | null
  run: GithubWorkflowRunWebhookRun
}): boolean {
  const { selector, run } = args
  if (selector === null) return false
  if (selector.selector === 'run') return selector.runId === run.id
  if (run.head_branch !== selector.branch) return false
  if (run.name === selector.workflow) return true
  return run.path !== undefined && run.path !== null && basenameOf(run.path) === selector.workflow
}

async function subscriptionsFor(args: {
  repoFullName: string
  run: GithubWorkflowRunWebhookRun
}): Promise<Row<'GithubSubscription'>[]> {
  const rows = await db.orm.public.GithubSubscription.where({
    kind: WORKFLOW_RUN_KIND,
    deliveredRunId: '',
  })
    .where((subscription) => subscription.repoFullName.ilike(repoPattern(args.repoFullName)))
    .where((subscription) => subscription.threadId.neq(''))
    .where((subscription) => subscription.liveUntil.gt(new Date()))
    .all()
  return rows.filter((row) =>
    runMatchesSelector({ selector: runSelectorOf(row.branch), run: args.run }),
  )
}

async function notifyOne(args: {
  subscription: Row<'GithubSubscription'>
  run: WorkflowRunSnapshot
  wake: GithubSandboxWakeService
}): Promise<boolean> {
  const claimed = await db.orm.public.GithubSubscription.where({
    id: args.subscription.id,
    deliveredRunId: '',
  }).updateAndCount({ deliveredRunId: args.run.id })
  if (claimed === 0) return false
  await db.transaction((tx) =>
    postRunNoticeV2Sessions({ tx, subscription: args.subscription, run: args.run }),
  )
  args.wake.notifyEvent({
    userId: args.subscription.userId,
    repoFullName: args.subscription.repoFullName,
    kind: 'workflow-run',
  })
  logger.log(
    `waking thread ${args.subscription.threadId} for the completed run ${args.run.id} of ${args.subscription.repoFullName}`,
  )
  return true
}

export async function recordWorkflowRunFinished(args: {
  payload: GithubWorkflowRunWebhookPayload
  wake: GithubSandboxWakeService
}): Promise<number> {
  if (args.payload.action !== 'completed') return 0
  if (args.payload.workflow_run.status !== 'completed') return 0
  const run = runSnapshotOf(args.payload)
  const subscriptions = await subscriptionsFor({
    repoFullName: args.payload.repository.full_name,
    run: args.payload.workflow_run,
  })
  let notified = 0
  for (const subscription of subscriptions) {
    const outcome = await notifyOne({ subscription, run, wake: args.wake }).catch(
      (failure: unknown) => {
        logger.warn(
          `notifying thread ${subscription.threadId} for the completed run ${run.id} of ${subscription.repoFullName} failed: ${failureText(failure)}`,
        )
        return false
      },
    )
    if (outcome) notified += 1
  }
  return notified
}
