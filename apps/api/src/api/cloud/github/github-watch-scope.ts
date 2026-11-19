import { and, db, or } from '@dltech/atlas-db'
import { repoPattern } from './github-pr-identity'

/**
 * The watch scope is the same liveness predicate the poll sweeper tracks with: a live
 * GithubSubscription (a session or user watching a pull request or a branch) or a live
 * GithubTrackingTarget (the materialized head/pull-request target, including session branches).
 * Nothing else decides what Atlas follows, so a delivery outside it carries no state any watcher
 * would read.
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

  return subscription != null || target != null
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
