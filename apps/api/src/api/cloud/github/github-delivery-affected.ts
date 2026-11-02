import { db, type Row } from '@dltech/atlas-db'
import { unsettledHeadExists } from './github-pr-head-checks'
import { repoPattern } from './github-pr-identity'

export const POST_MERGE_RECONCILE_WINDOW_MS = 30 * 60 * 1_000

/**
 * Merged PRs stay check-targetable for a short post-terminal window while their head's verdict
 * obligation is unsettled — the final green often lands after the merge delivery, and dropping
 * the PR from targeting the moment it merges closes the only repair path (#1635).
 */
export async function affectedPrsBySha(args: {
  repoFullName: string
  sha: string
}): Promise<Row<'GithubPrState'>[]> {
  const matched = await db.orm.public.GithubPrState.where((pr) =>
    pr.repoFullName.ilike(repoPattern(args.repoFullName)),
  )
    .where({ headSha: args.sha })
    .all()
  const prs: Row<'GithubPrState'>[] = []
  const windowOpen = Date.now() - POST_MERGE_RECONCILE_WINDOW_MS
  for (const row of matched) {
    if (row.state === 'open' || row.state === 'draft') {
      prs.push(row)
      continue
    }
    if (row.state !== 'merged' || row.updatedAt.getTime() < windowOpen) continue
    if (
      await unsettledHeadExists({
        repoFullName: row.repoFullName,
        prNumber: row.prNumber,
        headSha: row.headSha,
      })
    ) {
      prs.push(row)
    }
  }
  return prs
}
