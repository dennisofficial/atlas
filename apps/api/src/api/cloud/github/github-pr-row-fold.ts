import {
  checksRollup,
  checksTally,
  ECheckOutcome,
  EChecksState,
  EPrSource,
  EPrState,
  latestAttemptOutcomes,
  type CheckAttempt,
  type DerivedChecks,
  type MergeabilitySample,
  type PrFoldState,
} from '@dltech/atlas-core'
import type { Row } from '@dltech/atlas-db'

import { SUITE_KEY_PREFIX, runOrderOfKey } from './github-check-suites'
import type { PrScopeTx } from './github-pr-lock'

export function foldStateOfRow(row: Row<'GithubPrState'> | null): PrFoldState | null {
  if (row === null) return null

  return {
    repoFullName: row.repoFullName,
    prNumber: row.prNumber,
    pull: {
      repoFullName: row.repoFullName,
      prNumber: row.prNumber,
      title: row.title,
      url: row.url,
      state: row.state as EPrState,
      headBranch: row.headBranch,
      headSha: row.headSha,
      headRepoFullName: row.headRepoFullName,
      baseBranch: row.baseBranch,
      pullUpdatedAt: (row.pullUpdatedAt ?? row.updatedAt).toISOString(),
      closedAt: null,
      mergedAt: null,
      source: EPrSource.WebhookPull,
    },
    mergeability: mergeabilityOfRow(row),
    checks:
      row.checksState === null
        ? null
        : {
            headSha: row.headSha,
            running: row.checksRunning,
            passed: row.checksPassed,
            failed: row.checksFailed,
            ignored: row.checksIgnored,
            rollup: row.checksState as EChecksState,
          },
    version: row.version,
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

export async function checksDerivedOf(args: {
  tx: PrScopeTx
  repoFullName: string
  headSha: string
  baseBranch: string
}): Promise<DerivedChecks> {
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
  const attempts: CheckAttempt[] = rows
    .filter((row) => !row.checkKey.startsWith(SUITE_KEY_PREFIX))
    .map((row) => ({
      name: row.name,
      order: runOrderOfKey(row.checkKey),
      outcome: row.outcome as ECheckOutcome,
    }))
  const outcomes = latestAttemptOutcomes(attempts)
  const tally = checksTally(outcomes)

  return {
    headSha: args.headSha,
    running: tally.running,
    passed: tally.passed,
    failed: tally.failed,
    ignored: tally.ignored,
    rollup: outcomes.length === 0 ? null : checksRollup(outcomes),
    requiredContexts,
  }
}
