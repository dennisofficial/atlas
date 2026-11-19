import { and, db, or } from '@dltech/atlas-db'
import { normalizedRepo, repoPattern } from './github-pr-identity'

/**
 * The watch scope is what keeps a pull request on screen: a live GithubSubscription (a session or
 * user watching a pull request or a branch), a live GithubTrackingTarget (the materialized
 * head/pull-request target), or a session that stopped watching but still holds the link — the
 * V2SessionPullRequest row the plugin writes when a subscription is created survives its
 * expiry, and it is what the states stream and the session views replay from. Nothing else
 * decides what Atlas shows, so a delivery outside it carries no state any watcher would read.
 */
export type WatchedHead = { repoFullName: string; branch: string }

export type WatchScope = {
  repoFullName: string
  prNumbers?: readonly number[]
  heads?: readonly WatchedHead[]
}

type Condition = Parameters<typeof and>[number]

type WatchFields = {
  liveUntil: { gt(value: Date): Condition }
  repoFullName: { ilike(value: string): Condition }
  prNumber: { eq(value: number): Condition }
  branch: { eq(value: string): Condition }
}

/**
 * Answers false only when the delivery provably touches nothing watched. An empty scope is
 * ambiguous, and ambiguity is processed: a wrong skip loses a state update forever, a wrong
 * process costs the work this gate exists to avoid.
 */
export async function inWatchScope(scope: WatchScope): Promise<boolean> {
  const prNumbers = [
    ...new Set((scope.prNumbers ?? []).filter((n) => Number.isSafeInteger(n) && n > 0)),
  ]
  const heads = (scope.heads ?? []).filter((head) => head.branch !== '')
  if (prNumbers.length === 0 && heads.length === 0) return true

  const now = new Date()
  const where = watchWhere({ now, repoFullName: scope.repoFullName, prNumbers, heads })
  const [subscription, target] = await Promise.all([
    db.orm.public.GithubSubscription.where(where).first(),
    db.orm.public.GithubTrackingTarget.where(where).first(),
  ])
  if (subscription != null || target != null) return true

  return await trackedBySession({ repoFullName: scope.repoFullName, prNumbers, heads })
}

/**
 * The durable half of the snapshot: a session keeps the pull request or head it linked after the
 * subscription that created it lapses (plugins/github `subscription-created` writes
 * V2SessionPullRequest and never deletes it). Those rows decide which states a session view and
 * the states stream still replay, so a delivery they name is not skippable.
 */
async function trackedBySession(args: {
  repoFullName: string
  prNumbers: readonly number[]
  heads: readonly WatchedHead[]
}): Promise<boolean> {
  const repoFullName = normalizedRepo(args.repoFullName)
  if (args.prNumbers.length > 0) {
    const tracked = await db.orm.v2.V2SessionPullRequest.where((pr) =>
      or(
        ...args.prNumbers.map((prNumber) =>
          and(pr.repoFullName.eq(repoFullName), pr.prNumber.eq(prNumber)),
        ),
      ),
    ).first()
    if (tracked != null) return true
  }

  for (const head of args.heads) {
    const tracked = await db.orm.v2.V2SessionBranch.where({
      headRepo: normalizedRepo(head.repoFullName),
      branch: head.branch,
    }).first()
    if (tracked != null) return true
  }

  return false
}

/**
 * A status delivery names only a sha, so the pull requests it belongs to come from the rows
 * already held for that head. Check events that do name their pull requests skip this read.
 */
export async function headShaPrNumbers(args: {
  repoFullName: string
  headSha: string
}): Promise<number[]> {
  if (args.headSha === '') return []
  const rows = await db.orm.public.GithubPrState.where((pr) =>
    pr.repoFullName.ilike(repoPattern(args.repoFullName)),
  )
    .where({ headSha: args.headSha })
    .select('prNumber')
    .all()
  return rows.map((row) => row.prNumber)
}

function watchWhere(args: {
  now: Date
  repoFullName: string
  prNumbers: readonly number[]
  heads: readonly WatchedHead[]
}): (fields: WatchFields) => Condition {
  const repoPatternOf = (repoFullName: string) => repoPattern(repoFullName)
  return (fields) =>
    and(
      fields.liveUntil.gt(args.now),
      or(
        ...args.prNumbers.map((prNumber) =>
          and(
            fields.repoFullName.ilike(repoPatternOf(args.repoFullName)),
            fields.prNumber.eq(prNumber),
          ),
        ),
        ...args.heads.map((head) =>
          and(
            fields.repoFullName.ilike(repoPatternOf(head.repoFullName)),
            fields.branch.eq(head.branch),
          ),
        ),
      ),
    )
}
