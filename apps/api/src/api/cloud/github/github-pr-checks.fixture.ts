import { db } from '@dltech/atlas-db'
import { checkRunInputOf, recordCommitChecksLocked } from './github-commit-checks'

const AT = '2026-11-18T00:00:00Z'

const conclusionOf = (group: 'passed' | 'failed' | 'running') =>
  group === 'passed' ? 'success' : group === 'failed' ? 'failure' : null

export const completeRunningChecks = (args: { repoFullName?: string; headSha: string }) =>
  db.execute(
    db.raw
      .sql`UPDATE "GithubCommitCheck" SET "outcome" = 'passed', "sourceUpdatedAt" = now() WHERE "repoFullName" = ${args.repoFullName ?? 'compai/app'} AND "headSha" = ${args.headSha} AND "outcome" = 'running'`
      .affectedCount()
      .build(),
  )

export function seedHeadChecks(args: {
  headSha: string
  repoFullName?: string
  passed?: number
  failed?: number
  running?: number
}): Promise<void> {
  const groups = [
    ...Array.from({ length: args.passed ?? 0 }, () => 'passed' as const),
    ...Array.from({ length: args.failed ?? 0 }, () => 'failed' as const),
    ...Array.from({ length: args.running ?? 0 }, () => 'running' as const),
  ]
  const checks = groups.map((group, index) =>
    checkRunInputOf({
      id: index + 1,
      name: `job-${index + 1}`,
      status: group === 'running' ? 'in_progress' : 'completed',
      conclusion: conclusionOf(group),
      started_at: AT,
      completed_at: group === 'running' ? null : AT,
    }),
  )

  return recordCommitChecksLocked({
    repoFullName: args.repoFullName ?? 'compai/app',
    headSha: args.headSha,
    checks,
  })
}
