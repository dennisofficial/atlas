import type { Row } from '@dltech/atlas-db'
import { ESessionBucket, type SessionBucketCounts } from '@dltech/atlas-wire'

export const SIDEBAR_BUCKET_LIMIT = 20

export type BucketFacts = Pick<Row<'Session'>, 'archivedAt'>

export const sidebarBucketOf = (session: BucketFacts): ESessionBucket =>
  session.archivedAt === null ? ESessionBucket.Active : ESessionBucket.Archived

export function bucketSessions<S extends BucketFacts>(
  sessions: readonly S[],
): Record<ESessionBucket, S[]> {
  const buckets: Record<ESessionBucket, S[]> = {
    [ESessionBucket.Active]: [],
    [ESessionBucket.Archived]: [],
  }
  for (const session of sessions) {
    buckets[sidebarBucketOf(session)].push(session)
  }
  return buckets
}

export function countsOf(
  buckets: Record<ESessionBucket, readonly BucketFacts[]>,
): SessionBucketCounts {
  return {
    active: buckets[ESessionBucket.Active].length,
    archived: buckets[ESessionBucket.Archived].length,
  }
}
