import {
  checkRunOutcomeOf,
  checksTally,
  ECheckOutcome,
  latestAttemptOutcomes,
  statusContextOutcomeOf,
  type CheckAttempt,
  type ChecksCount,
} from '@dltech/atlas-core'
import { db } from '@dltech/atlas-db'
import { normalizedRepo } from './github-pr-identity'

export const COMMIT_CHECK_RETENTION_MS = 14 * 24 * 60 * 60 * 1_000

export type CommitCheckInput = {
  checkKey: string
  name: string
  startedAt: string | null
  outcome: ECheckOutcome
  sourceUpdatedAt: Date
  isRun: boolean
}

export type CheckRunShape = {
  id: number
  name: string
  status: string
  conclusion: string | null
  started_at: string | null
  completed_at?: string | null
}

export type CommitStatusShape = {
  context: string
  state: string
  created_at: string | null
  updated_at?: string | null
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
  }
}

export async function recordCommitChecks(args: {
  repoFullName: string
  headSha: string
  checks: readonly CommitCheckInput[]
}): Promise<void> {
  if (args.checks.length === 0) return
  const repoFullName = normalizedRepo(args.repoFullName)
  await db.transaction(async (tx) => {
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
  })
}

export async function commitChecksTally(args: {
  repoFullName: string
  headSha: string
}): Promise<ChecksCount> {
  const rows = await db.orm.public.GithubCommitCheck.where({
    repoFullName: normalizedRepo(args.repoFullName),
    headSha: args.headSha,
  }).all()
  const attempts: CheckAttempt[] = rows.map((row) => ({
    name: row.name,
    startedAt: row.checkKey.startsWith('status:')
      ? row.sourceUpdatedAt.toISOString()
      : row.startedAt,
    outcome: row.outcome as ECheckOutcome,
  }))
  return checksTally(latestAttemptOutcomes(attempts))
}

export async function pruneCommitChecks(args: { now: Date }): Promise<void> {
  const cutoff = new Date(args.now.getTime() - COMMIT_CHECK_RETENTION_MS)
  await db.orm.public.GithubCommitCheck.where((row) => row.updatedAt.lt(cutoff)).delete()
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
