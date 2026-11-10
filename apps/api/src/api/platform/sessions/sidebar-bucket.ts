import type { Row } from '@dltech/atlas-db'
import { ESessionBucket, type SessionBucketCounts } from '@dltech/atlas-wire'

export const INACTIVE_AFTER_MS = 72 * 60 * 60 * 1000

export const SIDEBAR_BUCKET_LIMIT = 20

export type BucketFacts = Pick<Row<'Session'>, 'archivedAt' | 'pinnedAt' | 'updatedAt'>

export function sidebarBucketOf(args: { session: BucketFacts; now: number }): ESessionBucket {
  const { session, now } = args
  if (session.archivedAt !== null) return ESessionBucket.Archived
  if (session.pinnedAt !== null) return ESessionBucket.Active
  return now - session.updatedAt.getTime() > INACTIVE_AFTER_MS
    ? ESessionBucket.Inactive
    : ESessionBucket.Active
}

export function bucketSessions<S extends BucketFacts>(args: {
  sessions: readonly S[]
  now: number
}): Record<ESessionBucket, S[]> {
  const buckets: Record<ESessionBucket, S[]> = {
    [ESessionBucket.Active]: [],
    [ESessionBucket.Inactive]: [],
    [ESessionBucket.Archived]: [],
  }
  for (const session of args.sessions) {
    buckets[sidebarBucketOf({ session, now: args.now })].push(session)
  }
  return buckets
}

export function countsOf(
  buckets: Record<ESessionBucket, readonly BucketFacts[]>,
): SessionBucketCounts {
  return {
    active: buckets[ESessionBucket.Active].length,
    inactive: buckets[ESessionBucket.Inactive].length,
    archived: buckets[ESessionBucket.Archived].length,
  }
}
