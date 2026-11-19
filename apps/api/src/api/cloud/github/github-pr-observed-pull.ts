import type { PrObservation } from '@dltech/atlas-core'
import { db } from '@dltech/atlas-db'
import type { BranchProtectionRead } from './github-branch-protection'
import { recordCommitChecks, type CommitCheckInput } from './github-commit-checks'
import { normalizedRepo } from './github-pr-identity'
import { lockPrScope } from './github-pr-lock'
import type { GithubPrStore, PrApplyResult } from './github-pr-store'

export async function applyObservedPull(args: {
  store: GithubPrStore
  repoFullName: string
  prNumber: number
  observations: readonly PrObservation[]
  headSha: string
  checks: readonly CommitCheckInput[]
  protection: BranchProtectionRead
  recipients?: readonly string[]
}): Promise<PrApplyResult> {
  const repoFullName = normalizedRepo(args.repoFullName)
  const write = await db.transaction(async (tx) => {
    const scope = await lockPrScope({ tx, repoFullName })
    await recordCommitChecks({
      tx: scope,
      repoFullName,
      headSha: args.headSha,
      checks: args.checks,
    })

    return await args.store.applyWithin({
      tx: scope,
      repoFullName,
      prNumber: args.prNumber,
      observations: args.observations,
      protection: args.protection,
      ...(args.recipients === undefined ? {} : { recipients: args.recipients }),
    })
  })
  await args.store.dispatch(write.outboxIds)

  return { applied: write.applied, row: write.row, changed: write.changed }
}
