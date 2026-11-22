import { Logger } from '@nestjs/common'
import { db, type Row } from '@dltech/atlas-db'

import { repoPattern } from './github-pr-identity'
import { WORKFLOW_RUN_KIND, runSelectorOf, type RunSelector } from './github-run-selector'
import type { WorkflowRunSnapshot } from './github-run-snapshot'
import { type GithubLegacyEffects, failureText } from './github-legacy-effects'
import { postRunNoticeV2Sessions } from './github-v2-run-notice'
import type {
  GithubWorkflowRunWebhookPayload,
  GithubWorkflowRunWebhookRun,
} from './github-webhook.types'

const logger = new Logger('GithubWorkflowRunWebhook')

const basenameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

const WORKFLOW_EXTENSION = /\.ya?ml$/i

const workflowKeyOf = (raw: string | null | undefined): string | null => {
  if (raw === undefined || raw === null) return null
  const base = basenameOf(raw).toLowerCase().replace(WORKFLOW_EXTENSION, '')
  return base.length === 0 ? null : base
}

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
  const wanted = workflowKeyOf(selector.workflow)
  if (wanted === null) return false
  return [run.name, run.path].some((name) => workflowKeyOf(name) === wanted)
}

const createdAtOf = (run: GithubWorkflowRunWebhookRun): Date | null => {
  if (run.created_at === undefined || run.created_at === null) return null
  const at = new Date(run.created_at)
  return Number.isNaN(at.getTime()) ? null : at
}

function matchesSubscription(args: {
  row: Row<'GithubSubscription'>
  run: GithubWorkflowRunWebhookRun
  runCreatedAt: Date | null
}): boolean {
  const selector = runSelectorOf(args.row.branch)
  if (!runMatchesSelector({ selector, run: args.run })) return false
  if (selector?.selector === 'run') return args.row.deliveredRunId === ''
  if (args.runCreatedAt === null) return true
  return args.runCreatedAt.getTime() > args.row.lastRunCreatedAt.getTime()
}

async function subscriptionsFor(args: {
  repoFullName: string
  run: GithubWorkflowRunWebhookRun
  runCreatedAt: Date | null
}): Promise<Row<'GithubSubscription'>[]> {
  const rows = await db.orm.public.GithubSubscription.where({ kind: WORKFLOW_RUN_KIND })
    .where((subscription) => subscription.repoFullName.ilike(repoPattern(args.repoFullName)))
    .where((subscription) => subscription.threadId.neq(''))
    .where((subscription) => subscription.liveUntil.gt(new Date()))
    .all()
  return rows.filter((row) =>
    matchesSubscription({ row, run: args.run, runCreatedAt: args.runCreatedAt }),
  )
}

function claimRun(args: {
  subscription: Row<'GithubSubscription'>
  run: WorkflowRunSnapshot
  runCreatedAt: Date
}): Promise<number> {
  if (runSelectorOf(args.subscription.branch)?.selector === 'run') {
    return db.orm.public.GithubSubscription.where({
      id: args.subscription.id,
      deliveredRunId: '',
    }).updateAndCount({ deliveredRunId: args.run.id })
  }
  return db.orm.public.GithubSubscription.where({
    id: args.subscription.id,
    lastRunCreatedAt: args.subscription.lastRunCreatedAt,
  }).updateAndCount({ lastRunCreatedAt: args.runCreatedAt })
}

async function notifyOne(args: {
  subscription: Row<'GithubSubscription'>
  run: WorkflowRunSnapshot
  runCreatedAt: Date
  wake: Pick<GithubLegacyEffects, 'notifyEvent'>
}): Promise<boolean> {
  const claimed = await claimRun(args)
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
  wake: Pick<GithubLegacyEffects, 'notifyEvent'>
}): Promise<number> {
  if (args.payload.action !== 'completed') return 0
  if (args.payload.workflow_run.status !== 'completed') return 0
  const run = runSnapshotOf(args.payload)
  const runCreatedAt = createdAtOf(args.payload.workflow_run)
  const subscriptions = await subscriptionsFor({
    repoFullName: args.payload.repository.full_name,
    run: args.payload.workflow_run,
    runCreatedAt,
  })
  let notified = 0
  for (const subscription of subscriptions) {
    const outcome = await notifyOne({
      subscription,
      run,
      runCreatedAt: runCreatedAt ?? new Date(),
      wake: args.wake,
    }).catch((failure: unknown) => {
      logger.warn(
        `notifying thread ${subscription.threadId} for the completed run ${run.id} of ${subscription.repoFullName} failed: ${failureText(failure)}`,
      )
      return false
    })
    if (outcome) notified += 1
  }
  return notified
}
