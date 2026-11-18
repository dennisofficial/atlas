import type { Tx } from '@dltech/atlas-db'

export type BranchProtectionRead = {
  baseBranch: string
  requiredContexts: readonly string[] | null
}

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
  const requiredContexts = [...contexts]
  const fetchedAt = new Date()
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
