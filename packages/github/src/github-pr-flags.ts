import { EPrState, type PrFoldState } from '@dltech/atlas-core'
import type { Row } from '@dltech/atlas-db'

import type { PrScopeTx } from './github-pr-lock'

export type PrMergeFlags = { mergeQueued: boolean; autoMerge: boolean }

const settledOf = (state: string): boolean => state === EPrState.Closed || state === EPrState.Merged

/**
 * A closed or merged pull request can be in neither the queue nor an auto-merge wait, so both
 * flags are cleared rather than carried. Otherwise the flags a webhook wrote stand until the next
 * one, so an unrelated fold change must not wipe them.
 */
export function mergeFlagsOf(args: {
  stored: Row<'GithubPrState'> | null
  state: PrFoldState
}): PrMergeFlags {
  const state = args.state.pull?.state
  if (state === undefined || settledOf(state)) return { mergeQueued: false, autoMerge: false }

  return {
    mergeQueued: args.stored?.mergeQueued ?? false,
    autoMerge: args.stored?.autoMerge ?? false,
  }
}

/**
 * Writes a queue or auto-merge flag straight onto a stored row and returns it when something
 * moved, so a merge-queue delivery that changes no folded field still announces a new version.
 */
export async function writePrFlags(args: {
  tx: PrScopeTx
  repoFullName: string
  prNumber: number
  flags: Partial<PrMergeFlags>
}): Promise<Row<'GithubPrState'> | null> {
  const stored = await args.tx.orm.public.GithubPrState.where({
    repoFullName: args.repoFullName,
    prNumber: args.prNumber,
  }).first()
  if (stored === null) return null
  const settled = settledOf(stored.state)
  const mergeQueued = settled ? false : (args.flags.mergeQueued ?? stored.mergeQueued)
  const autoMerge = settled ? false : (args.flags.autoMerge ?? stored.autoMerge)
  if (mergeQueued === stored.mergeQueued && autoMerge === stored.autoMerge) return null

  return await args.tx.orm.public.GithubPrState.where({
    repoFullName: args.repoFullName,
    prNumber: args.prNumber,
  }).update({ mergeQueued, autoMerge, updatedAt: new Date(), version: stored.version + 1 })
}
