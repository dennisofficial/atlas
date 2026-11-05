import {
  clipCheckText,
  checkRunOutcomeOf,
  checksTally,
  ECheckOutcome,
  latestAttemptOutcomes,
  statusContextOutcomeOf,
  type CheckAttempt,
  type ChecksCount,
} from '@dltech/atlas-core'
import { db, type Tx } from '@dltech/atlas-db'
import {
  RUN_KEY_PREFIX,
  SUITE_KEY_PREFIX,
  countsAsPendingSuite,
  runnerAppSlugs,
} from './github-check-suites'
import { normalizedRepo } from './github-pr-identity'
import type { GithubPrCheckAnnotation } from './github-realtime.types'

export const COMMIT_CHECK_RETENTION_MS = 14 * 24 * 60 * 60 * 1_000

export type CommitCheckInput = {
  checkKey: string
  name: string
  startedAt: string | null
  outcome: ECheckOutcome
  sourceUpdatedAt: Date
  isRun: boolean
  appSlug?: string | null
  detailsUrl?: string | null
  title?: string | null
  summary?: string | null
  annotationsCount?: number | null
  annotations?: GithubPrCheckAnnotation[]
}

export type CheckRunShape = {
  id: number
  name: string
  status: string
  conclusion: string | null
  started_at: string | null
  completed_at?: string | null
  app?: { slug: string } | null
  html_url?: string | null
  output?: {
    title?: string | null
    summary?: string | null
    annotations_count?: number | null
  } | null
}

export type CommitStatusShape = {
  context: string
  state: string
  created_at: string | null
  updated_at?: string | null
  target_url?: string | null
  description?: string | null
}

const timeOf = (iso: string | null | undefined): Date | null =>
  iso === null || iso === undefined ? null : new Date(iso)

export function checkRunInputOf(run: CheckRunShape): CommitCheckInput {
  return {
    checkKey: `run:${run.id}`,
    name: run.name,
    startedAt: run.started_at,
    outcome: checkRunOutcomeOf({
      status: run.status,
      conclusion: run.conclusion,
    }),
    sourceUpdatedAt: timeOf(run.completed_at) ?? timeOf(run.started_at) ?? new Date(),
    isRun: true,
    appSlug: run.app?.slug ?? null,
    detailsUrl: run.html_url ?? null,
    title: clipCheckText(run.output?.title) ?? null,
    summary: clipCheckText(run.output?.summary) ?? null,
    annotationsCount: run.output?.annotations_count ?? null,
  }
}

export function commitStatusInputOf(status: CommitStatusShape): CommitCheckInput {
  return {
    checkKey: `status:${status.context}`,
    name: status.context,
    startedAt: status.created_at,
    outcome: statusContextOutcomeOf(status.state),
    sourceUpdatedAt: timeOf(status.updated_at) ?? timeOf(status.created_at) ?? new Date(),
    isRun: false,
    detailsUrl: status.target_url ?? null,
    summary: clipCheckText(status.description) ?? null,
  }
}

export async function lockCommit(args: {
  tx: Tx
  repoFullName: string
  headSha: string
}): Promise<void> {
  const key = `${normalizedRepo(args.repoFullName)}@${args.headSha}`
  await args.tx.execute(
    args.tx.raw.sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`.affectedCount().build(),
  )
}

export async function recordCommitChecksLocked(args: {
  repoFullName: string
  headSha: string
  checks: readonly CommitCheckInput[]
}): Promise<void> {
  if (args.checks.length === 0) return
  await db.transaction(async (tx) => {
    await lockCommit({ tx, ...args })
    await recordCommitChecks({ tx, ...args })
  })
}

export async function recordCheckCounts(args: {
  repoFullName: string
  headSha: string
  checks: readonly CommitCheckInput[]
}): Promise<ReturnType<typeof checkCountFieldsOf>> {
  const tally = await db.transaction(async (tx) => {
    await lockCommit({ tx, ...args })
    await recordCommitChecks({ tx, ...args })
    return commitChecksTally({ tx, repoFullName: args.repoFullName, headSha: args.headSha })
  })
  return checkCountFieldsOf(tally)
}

export const checkCountFieldsOf = (tally: ChecksCount) => ({
  checksRunning: tally.running,
  checksPassed: tally.passed,
  checksFailed: tally.failed,
  checksIgnored: tally.ignored,
})

export async function recordCommitChecks(args: {
  tx: Tx
  repoFullName: string
  headSha: string
  checks: readonly CommitCheckInput[]
}): Promise<void> {
  if (args.checks.length === 0) return
  const repoFullName = normalizedRepo(args.repoFullName)
  {
    const { tx } = args
    const existing = await tx.orm.public.GithubCommitCheck.where({
      repoFullName,
      headSha: args.headSha,
    }).all()
    const byKey = new Map(existing.map((row) => [row.checkKey, row]))
    for (const check of args.checks) {
      const held = byKey.get(check.checkKey)
      if (held !== undefined) {
        const heldCompleted = held.outcome !== ECheckOutcome.Running
        const heldNewer = held.sourceUpdatedAt.getTime() > check.sourceUpdatedAt.getTime()
        const staleRun = heldCompleted && (check.outcome === ECheckOutcome.Running || heldNewer)
        if (check.isRun ? staleRun : heldNewer) continue
      }
      const fields = {
        name: check.name,
        startedAt: check.startedAt,
        outcome: check.outcome,
        sourceUpdatedAt: check.sourceUpdatedAt,
        appSlug: check.appSlug ?? null,
        detailsUrl: check.detailsUrl ?? null,
        title: check.title ?? null,
        summary: check.summary ?? null,
        annotationsCount: check.annotationsCount ?? null,
        ...(check.annotations === undefined ? {} : { annotations: check.annotations }),
      }
      await tx.orm.public.GithubCommitCheck.upsert({
        conflictOn: {
          repoFullName,
          headSha: args.headSha,
          checkKey: check.checkKey,
        },
        create: {
          repoFullName,
          headSha: args.headSha,
          checkKey: check.checkKey,
          ...fields,
        },
        update: fields,
      })
    }
  }
}

export async function commitChecksTally(args: {
  tx: Tx
  repoFullName: string
  headSha: string
}): Promise<ChecksCount> {
  const rows = await args.tx.orm.public.GithubCommitCheck.where({
    repoFullName: normalizedRepo(args.repoFullName),
    headSha: args.headSha,
  }).all()
  const runners = await runnerAppSlugs({ tx: args.tx, repoFullName: args.repoFullName })
  const attempts: CheckAttempt[] = rows
    .filter(
      (row) => !row.checkKey.startsWith(SUITE_KEY_PREFIX) || countsAsPendingSuite({ row, runners }),
    )
    .map((row) => ({
      name: row.name,
      startedAt: row.checkKey.startsWith('status:')
        ? row.sourceUpdatedAt.toISOString()
        : row.startedAt,
      outcome: row.outcome as ECheckOutcome,
    }))
  const awaitsFirstRun =
    runners.size > 0 &&
    rows.length > 0 &&
    !rows.some((row) => row.checkKey.startsWith(RUN_KEY_PREFIX))
  if (awaitsFirstRun) attempts.push({ name: null, startedAt: null, outcome: ECheckOutcome.Running })
  return checksTally(latestAttemptOutcomes(attempts))
}

export async function pruneCommitChecks(args: { now: Date }): Promise<void> {
  const cutoff = new Date(args.now.getTime() - COMMIT_CHECK_RETENTION_MS)
  await db.execute(
    db.raw
      .sql`DELETE FROM "GithubCommitCheck" WHERE "updatedAt" < ${cutoff.toISOString()}::timestamptz`
      .affectedCount()
      .build(),
  )
}

export function restCommitChecksOf(args: {
  checkRuns: readonly CheckRunShape[]
  statuses: readonly CommitStatusShape[]
}): CommitCheckInput[] {
  const latestByContext = new Map<string, CommitStatusShape>()
  for (const status of args.statuses) {
    if (!latestByContext.has(status.context)) latestByContext.set(status.context, status)
  }
  return [
    ...args.checkRuns.map(checkRunInputOf),
    ...[...latestByContext.values()].map(commitStatusInputOf),
  ]
}
