import {
  derivedChecksOf,
  ECheckOutcome,
  ECheckSource,
  EPrSource,
  EPrState,
  EStoredChecksState,
  latestCheckAttempts,
  missingRequiredContextsOf,
  rollupOfStoredChecksState,
  storedChecksStateOf,
  type CheckIdentity,
  type DerivedChecks,
  type MergeabilitySample,
  type PrChecksSummary,
  type PrFoldState,
} from '@dltech/atlas-core'
import type { Row } from '@dltech/atlas-db'

import { RUN_KEY_PREFIX, SUITE_KEY_PREFIX } from './github-check-suites'
import type { PrScopeTx } from './github-pr-lock'

export function foldStateOfRow(row: Row<'GithubPrState'> | null): PrFoldState | null {
  if (row === null) return null

  return {
    repoFullName: row.repoFullName,
    prNumber: row.prNumber,
    pull: pullOfRow({ row, pullUpdatedAt: row.pullUpdatedAt }),
    mergeability: mergeabilityOfRow(row),
    checks: checksOfRow(row),
    version: row.version,
  }
}

function pullOfRow(args: {
  row: Row<'GithubPrState'>
  pullUpdatedAt: Date | null
}): PrFoldState['pull'] {
  const row = args.row

  return {
    repoFullName: row.repoFullName,
    prNumber: row.prNumber,
    title: row.title,
    url: row.url,
    state: row.state as EPrState,
    headBranch: row.headBranch,
    headSha: row.headSha,
    headRepoFullName: row.headRepoFullName,
    baseBranch: row.baseBranch,
    pullUpdatedAt: args.pullUpdatedAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    mergedAt: row.mergedAt?.toISOString() ?? null,
    source: EPrSource.WebhookPull,
  }
}

function checksOfRow(row: Row<'GithubPrState'>): PrChecksSummary | null {
  const rollup = rollupOfStoredChecksState(row.checksState)
  if (rollup === null) return null

  return {
    headSha: row.headSha,
    running: row.checksRunning,
    passed: row.checksPassed,
    failed: row.checksFailed,
    ignored: row.checksIgnored,
    rollup,
  }
}

function mergeabilityOfRow(row: Row<'GithubPrState'>): MergeabilitySample | null {
  if (
    row.mergeableHeadSha === null ||
    row.mergeableBaseRef === null ||
    row.mergeableObservedAt === null
  ) {
    return null
  }

  return {
    headSha: row.mergeableHeadSha,
    baseBranch: row.mergeableBaseRef,
    mergeable: row.mergeable,
    mergeClean: row.mergeClean,
    observedAt: row.mergeableObservedAt.toISOString(),
  }
}

export function checkIdentitiesOf(rows: readonly Row<'GithubCommitCheck'>[]): CheckIdentity[] {
  return rows
    .filter((row) => !row.checkKey.startsWith(SUITE_KEY_PREFIX))
    .map((row) => ({
      appSlug: row.appSlug,
      checkKey: row.checkKey,
      name: row.name ?? '',
      outcome: row.outcome as ECheckOutcome,
      source: row.checkKey.startsWith(RUN_KEY_PREFIX) ? ECheckSource.Run : ECheckSource.Status,
      sourceCreatedAt: row.sourceUpdatedAt.toISOString(),
      sourceId: row.sourceId ?? row.checkKey.slice(row.checkKey.indexOf(':') + 1),
    }))
}

export async function headChecksOf(args: {
  tx: PrScopeTx
  repoFullName: string
  headSha: string
  baseBranch: string
}): Promise<{
  derived: DerivedChecks
  identities: CheckIdentity[]
  checksState: EStoredChecksState | null
  missingRequiredContexts: number
}> {
  const requiredContexts =
    args.baseBranch === ''
      ? []
      : ((
          await args.tx.orm.public.GithubBranchProtection.where({
            repoFullName: args.repoFullName,
            baseBranch: args.baseBranch,
          }).first()
        )?.requiredContexts ?? [])
  const rows = await args.tx.orm.public.GithubCommitCheck.where({
    repoFullName: args.repoFullName,
    headSha: args.headSha,
  }).all()
  const identities = checkIdentitiesOf(rows)
  const derived = derivedChecksOf({ attempts: identities, headSha: args.headSha, requiredContexts })
  const missing = missingRequiredContextsOf({
    requiredContexts,
    reportedContexts: identities.map((identity) => identity.name),
  })
  const outcomes = latestCheckAttempts({ attempts: identities }).map((attempt) => attempt.outcome)

  return {
    derived,
    identities,
    checksState: storedChecksStateOf({ outcomes, missingRequiredContexts: missing }),
    missingRequiredContexts: missing.length,
  }
}
