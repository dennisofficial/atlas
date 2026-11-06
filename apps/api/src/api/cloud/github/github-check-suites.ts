import { ECheckOutcome } from '@dltech/atlas-core'
import type { Tx } from '@dltech/atlas-db'
import type { CommitCheckInput } from './github-commit-checks'
import { normalizedRepo } from './github-pr-identity'

export type CheckSuiteShape = {
  id: number
  status: string | null
  updated_at?: string | null
  app?: { slug: string } | null
}

export const RUN_KEY_PREFIX = 'run:'
export const SUITE_KEY_PREFIX = 'suite:'

export function runOrderOfKey(checkKey: string): number | null {
  if (!checkKey.startsWith(RUN_KEY_PREFIX)) return null
  const id = Number(checkKey.slice(RUN_KEY_PREFIX.length))
  return Number.isSafeInteger(id) ? id : null
}

export function checkSuiteInputOf(suite: CheckSuiteShape): CommitCheckInput {
  return {
    checkKey: `${SUITE_KEY_PREFIX}${suite.id}`,
    name: `${SUITE_KEY_PREFIX}${suite.id}`,
    startedAt: null,
    outcome: suite.status === 'completed' ? ECheckOutcome.Ignored : ECheckOutcome.Running,
    sourceUpdatedAt: suite.updated_at == null ? new Date() : new Date(suite.updated_at),
    isRun: true,
    appSlug: suite.app?.slug ?? null,
  }
}

export async function runnerAppSlugs(args: { tx: Tx; repoFullName: string }): Promise<Set<string>> {
  const rows = await args.tx.query(
    args.tx.raw
      .sql`SELECT DISTINCT "appSlug" FROM "GithubCommitCheck" WHERE "repoFullName" = ${normalizedRepo(args.repoFullName)} AND "checkKey" LIKE 'run:%' AND "appSlug" IS NOT NULL`
      .returnsRow({ appSlug: 'pg/text@1' })
      .build(),
  )
  const slugs = new Set<string>()
  for await (const row of rows) slugs.add(row.appSlug)
  return slugs
}

export function countsAsPendingSuite(args: {
  row: { checkKey: string; outcome: string; appSlug: string | null }
  runners: ReadonlySet<string>
}): boolean {
  return (
    args.row.outcome === ECheckOutcome.Running &&
    args.row.appSlug !== null &&
    args.runners.has(args.row.appSlug)
  )
}
