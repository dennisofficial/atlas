import type { Tx } from '@dltech/atlas-db'

export type BranchProtectionRead = {
  acquiredAt: Date
  baseBranch: string
  requiredContexts: readonly string[] | null
}

const LOCK_NAMESPACE = 'gh-branch-protection:'

export type RememberedProtection = {
  baseBranch: string
  requiredContexts: readonly string[]
}

/**
 * Returns the required contexts the row now holds for the branch, so a caller that needs them in the
 * same transaction can use this instead of reading the row it just wrote.
 */
export async function rememberBranchProtection(args: {
  tx: Tx
  repoFullName: string
  protection: BranchProtectionRead
}): Promise<RememberedProtection | null> {
  const contexts = args.protection.requiredContexts
  if (contexts === null || args.protection.baseBranch === '') return null
  const baseBranch = args.protection.baseBranch
  const key = `${LOCK_NAMESPACE}${args.repoFullName}:${baseBranch}`
  await args.tx.execute(
    args.tx.raw.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`
      .affectedCount()
      .build(),
  )
  const stored = await args.tx.orm.public.GithubBranchProtection.where({
    repoFullName: args.repoFullName,
    baseBranch,
  }).first()
  if (stored !== null && stored.fetchedAt.getTime() > args.protection.acquiredAt.getTime()) {
    return { baseBranch, requiredContexts: stored.requiredContexts ?? [] }
  }
  const requiredContexts = [...contexts]
  const fetchedAt = args.protection.acquiredAt
  await args.tx.orm.public.GithubBranchProtection.upsert({
    conflictOn: { repoFullName: args.repoFullName, baseBranch },
    create: {
      repoFullName: args.repoFullName,
      baseBranch,
      requiredContexts,
      fetchedAt,
    },
    update: { requiredContexts, fetchedAt },
  })

  return { baseBranch, requiredContexts }
}
