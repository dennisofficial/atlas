import { rawSql } from '@prisma/orm-postgres/migration'

const label =
  'Recompute open pull request check tallies from the stored check runs and statuses, so a queued suite no longer counts as a running check'

const latestAttemptOutcomes = `WITH ranked AS (
  SELECT
    c."repoFullName",
    c."headSha",
    c.outcome,
    row_number() OVER (
      PARTITION BY c."repoFullName", c."headSha", c.name
      ORDER BY (split_part(c."checkKey", ':', 2))::bigint DESC
    ) AS rn
  FROM "public"."GithubCommitCheck" AS c
  WHERE c."checkKey" LIKE 'run:%'
    AND c.name IS NOT NULL
), kept AS (
  SELECT "repoFullName", "headSha", outcome FROM ranked WHERE rn = 1
  UNION ALL
  SELECT "repoFullName", "headSha", outcome
  FROM "public"."GithubCommitCheck"
  WHERE "checkKey" LIKE 'run:%' AND name IS NULL
  UNION ALL
  SELECT "repoFullName", "headSha", outcome
  FROM "public"."GithubCommitCheck"
  WHERE "checkKey" LIKE 'status:%'
), tally AS (
  SELECT
    "repoFullName",
    "headSha",
    (count(*) FILTER (WHERE outcome = 'running'))::int AS running,
    (count(*) FILTER (WHERE outcome = 'passed'))::int AS passed,
    (count(*) FILTER (WHERE outcome = 'failed'))::int AS failed,
    (count(*) FILTER (WHERE outcome = 'ignored'))::int AS ignored
  FROM kept
  GROUP BY "repoFullName", "headSha"
)`

export const recomputeOpenPullRequestTallies = rawSql({
  id: 'data.pr-checks-tally-recompute',
  invariantId: 'pr-checks-tally-v1',
  label,
  operationClass: 'data',
  target: {
    id: 'table.GithubPrState',
    details: { schema: 'public', objectType: 'table' as const, name: 'GithubPrState' },
  },
  precheck: [],
  execute: [
    {
      description: label,
      sql: `${latestAttemptOutcomes}
      UPDATE "public"."GithubPrState" AS p
      SET "checksRunning" = tally.running,
          "checksPassed" = tally.passed,
          "checksFailed" = tally.failed,
          "checksIgnored" = tally.ignored
      FROM tally
      WHERE p."repoFullName" = tally."repoFullName"
        AND p."headSha" = tally."headSha"
        AND p.state IN ('open', 'draft')
        AND (p."checksRunning" IS DISTINCT FROM tally.running
          OR p."checksPassed" IS DISTINCT FROM tally.passed
          OR p."checksFailed" IS DISTINCT FROM tally.failed
          OR p."checksIgnored" IS DISTINCT FROM tally.ignored)`,
    },
  ],
  postcheck: [],
})
