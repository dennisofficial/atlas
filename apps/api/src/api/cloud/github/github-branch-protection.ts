import type { Tx } from '@dltech/atlas-db'

export type BranchProtectionRead = {
  acquiredAt: Date
  baseBranch: string
  requiredContexts: readonly string[] | null
}

const LOCK_NAMESPACE = 'gh-branch-protection:'

/**
 * The read answers null when GitHub would not say, and a stored answer of "requires nothing" is
 * what lets a verdict settle early, so an unanswered read leaves what is stored alone.
 */
export async function rememberBranchProtection(args: {
  tx: Tx
  repoFullName: string
  protection: BranchProtectionRead
}): Promise<void> {
  const contexts = args.protection.requiredContexts
  if (contexts === null || args.protection.baseBranch === '') return
  const key = `${LOCK_NAMESPACE}${args.repoFullName}:${args.protection.baseBranch}`
  await args.tx.execute(
    args.tx.raw.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`
      .affectedCount()
      .build(),
  )
  const stored = await args.tx.orm.public.GithubBranchProtection.where({
    repoFullName: args.repoFullName,
    baseBranch: args.protection.baseBranch,
  }).first()
  if (stored !== null && stored.fetchedAt.getTime() > args.protection.acquiredAt.getTime()) return
  const requiredContexts = [...contexts]
  const fetchedAt = args.protection.acquiredAt
  await args.tx.orm.public.GithubBranchProtection.upsert({
    conflictOn: { repoFullName: args.repoFullName, baseBranch: args.protection.baseBranch },
    create: {
      repoFullName: args.repoFullName,
      baseBranch: args.protection.baseBranch,
      requiredContexts,
      fetchedAt,
    },
    update: { requiredContexts, fetchedAt },
  })
}
