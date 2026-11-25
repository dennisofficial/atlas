import { db } from '@dltech/atlas-db'
import { TRACKING_TARGET_TTL_MS } from '@dltech/atlas-plugin-github/control'

export const RENEWAL_WINDOW_MS = 24 * 60 * 60_000
export const RENEWAL_BATCH = 500

export async function renewTrackedHeadTargets(args: { now?: Date } = {}): Promise<void> {
  const now = args.now ?? new Date()
  const renewedUntil = new Date(now.getTime() + TRACKING_TARGET_TTL_MS)
  const nearExpiry = new Date(now.getTime() + RENEWAL_WINDOW_MS)
  await db.execute(
    db.raw.sql`
      UPDATE "GithubTrackingTarget" AS target
      SET "liveUntil" = ${renewedUntil.toISOString()}::timestamptz
      WHERE target.id IN (
        SELECT due.id
        FROM "GithubTrackingTarget" AS due
        JOIN "public"."Session" AS session
          ON session."userId" = due."userId" AND session."archivedAt" IS NULL
        JOIN "public"."SessionBranch" AS branch
          ON branch."sessionId" = session.id
         AND branch."headRepo" = lower(due."repoFullName")
         AND branch."branch" = due."branch"
        WHERE due.kind = 'head'
          AND due."liveUntil" > ${now.toISOString()}::timestamptz
          AND due."liveUntil" < ${nearExpiry.toISOString()}::timestamptz
        ORDER BY due."liveUntil"
        LIMIT ${RENEWAL_BATCH}::int
      )
    `
      .affectedCount()
      .build(),
  )
}
