import { db } from '@dltech/atlas-db'
import { normalizedRepo } from './github-pr-identity'

/**
 * The watch scope is what keeps a pull request on screen: a live GithubSubscription (a session or
 * user watching a pull request or a branch), a live GithubTrackingTarget (the materialized
 * head/pull-request target), or a session that stopped watching but still holds the link — the
 * V2SessionPullRequest row the plugin writes when a subscription is created survives its
 * expiry, and it is what the states stream and the session views replay from. Nothing else
 * decides what Atlas shows, so a delivery outside it carries no state any watcher would read.
 *
 * Every repo the four tables key on is written through `normalizedRepo`, so the lookup is plain
 * equality on the lower-cased name and rides each table's `repoFullName` index instead of an
 * `ilike` scan.
 */
export type WatchedHead = { repoFullName: string; branch: string }

export type WatchScope = {
  repoFullName: string
  prNumbers?: readonly number[]
  heads?: readonly WatchedHead[]
  headSha?: string
}

/**
 * Answers false only when the delivery provably touches nothing watched. An empty scope is
 * ambiguous, and ambiguity is processed: a wrong skip loses a state update forever, a wrong
 * process costs the work this gate exists to avoid.
 *
 * One statement covers all four tables (and, for a delivery that names only a sha, the pull
 * requests that sha belongs to), because this is the statement every webhook delivery pays for.
 */
export async function inWatchScope(scope: WatchScope): Promise<boolean> {
  const prNumbers = [
    ...new Set((scope.prNumbers ?? []).filter((n) => Number.isSafeInteger(n) && n > 0)),
  ]
  const heads = (scope.heads ?? []).filter((head) => head.branch !== '')
  const headSha = scope.headSha ?? ''
  if (prNumbers.length === 0 && heads.length === 0 && headSha === '') return true

  const rows = await db.query(
    db.raw.sql`WITH pulls AS (
        SELECT pull."prNumber"::int AS "prNumber" FROM jsonb_array_elements_text(${JSON.stringify(prNumbers)}::jsonb) AS pull("prNumber")
        UNION
        SELECT state."prNumber" FROM "GithubPrState" AS state
        WHERE state."repoFullName" = ${normalizedRepo(scope.repoFullName)}
          AND state."headSha" = ${headSha}
          AND ${headSha} <> ''
      ), heads AS (
        SELECT head."repoFullName", head."branch"
        FROM jsonb_to_recordset(${JSON.stringify(heads.map((head) => ({ repoFullName: normalizedRepo(head.repoFullName), branch: head.branch })))}::jsonb) AS head("repoFullName" text, "branch" text)
      )
      SELECT EXISTS (
        SELECT 1 FROM "GithubSubscription" AS watched
        WHERE watched."liveUntil" > ${new Date().toISOString()}::timestamptz
          AND (
            (watched."repoFullName" = ${normalizedRepo(scope.repoFullName)}
              AND watched."prNumber" IN (SELECT "prNumber" FROM pulls))
            OR EXISTS (
              SELECT 1 FROM heads
              WHERE heads."repoFullName" = watched."repoFullName" AND heads."branch" = watched."branch"
            )
          )
        UNION ALL
        SELECT 1 FROM "GithubTrackingTarget" AS watched
        WHERE watched."liveUntil" > ${new Date().toISOString()}::timestamptz
          AND (
            (watched."repoFullName" = ${normalizedRepo(scope.repoFullName)}
              AND watched."prNumber" IN (SELECT "prNumber" FROM pulls))
            OR EXISTS (
              SELECT 1 FROM heads
              WHERE heads."repoFullName" = watched."repoFullName" AND heads."branch" = watched."branch"
            )
          )
        UNION ALL
        SELECT 1 FROM "v2"."V2SessionPullRequest" AS tracked
        WHERE tracked."repoFullName" = ${normalizedRepo(scope.repoFullName)}
          AND tracked."prNumber" IN (SELECT "prNumber" FROM pulls)
        UNION ALL
        SELECT 1 FROM "v2"."V2SessionBranch" AS tracked
        WHERE EXISTS (
          SELECT 1 FROM heads
          WHERE heads."repoFullName" = tracked."headRepo" AND heads."branch" = tracked."branch"
        )
      ) AS "watched"`
      .returnsRow({ watched: 'pg/bool@1' })
      .build(),
  )

  for await (const row of rows) return row.watched === true
  return false
}
