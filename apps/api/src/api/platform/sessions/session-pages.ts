import { and, db, or, type Row } from '@dltech/atlas-db'
import {
  ESessionBucket,
  type LiveThreadRow,
  type SessionBucketCounts,
  type SessionPageOutput,
} from '@dltech/atlas-wire'
import { BadRequestException } from '@nestjs/common'
import { liveRowsOf } from './live-snapshot'
import { bucketSessions, countsOf, sidebarBucketOf } from './sidebar-bucket'

export const SESSION_PAGE_DEFAULT_LIMIT = 20
export const SESSION_PAGE_MAX_LIMIT = 100
export const SESSION_PAGE_SCAN_BATCH = 100

export type PageBucket = ESessionBucket.Inactive | ESessionBucket.Archived

type PageCursor = { updatedAt: Date; id: string }

const CURSOR_SEPARATOR = '|'

const likePatternOf = (search: string): string => `%${search.replace(/[\\%_]/g, '\\$&')}%`

const cursorStringOf = (cursor: PageCursor): string =>
  `${cursor.updatedAt.toISOString()}${CURSOR_SEPARATOR}${cursor.id}`

function cursorOf(cursor: string): PageCursor {
  const separator = cursor.lastIndexOf(CURSOR_SEPARATOR)
  if (separator < 0) throw new BadRequestException('invalid cursor')
  const updatedAt = new Date(cursor.slice(0, separator))
  const id = cursor.slice(separator + 1)
  if (id.length === 0 || Number.isNaN(updatedAt.getTime())) {
    throw new BadRequestException('invalid cursor')
  }
  return { updatedAt, id }
}

function ownedSessions(args: { userId: string; search: string }) {
  const owned = db.orm.public.Session.where({ userId: args.userId }).where((session) =>
    session.mainThreadId.isNotNull(),
  )
  if (args.search.length === 0) return owned
  return owned.where((session) => session.title.ilike(likePatternOf(args.search)))
}

async function countsOfSearch(args: {
  userId: string
  search: string
  now: number
}): Promise<SessionBucketCounts> {
  const sessions = await ownedSessions(args).select('archivedAt', 'pinnedAt', 'updatedAt').all()
  return countsOf(bucketSessions({ sessions, now: args.now }))
}

function scanBatchOf(args: {
  userId: string
  search: string
  after: PageCursor | undefined
  limit: number
}) {
  const scoped = ownedSessions(args)
  const after = args.after
  const keyed =
    after === undefined
      ? scoped
      : scoped.where((session) =>
          or(
            session.updatedAt.lt(after.updatedAt),
            and(session.updatedAt.eq(after.updatedAt), session.id.lt(after.id)),
          ),
        )
  return keyed
    .orderBy([(session) => session.updatedAt.desc(), (session) => session.id.desc()])
    .limit(args.limit)
    .all()
}

export async function pageSessions(args: {
  userId: string
  bucket: PageBucket
  cursor?: string | undefined
  limit?: number | undefined
  search?: string | undefined
}): Promise<SessionPageOutput> {
  const now = Date.now()
  const limit = Math.min(args.limit ?? SESSION_PAGE_DEFAULT_LIMIT, SESSION_PAGE_MAX_LIMIT)
  const search = args.search?.trim() ?? ''
  const counts = await countsOfSearch({ userId: args.userId, search, now })
  let after = args.cursor === undefined ? undefined : cursorOf(args.cursor)
  const kept: Row<'Session'>[] = []
  while (kept.length <= limit) {
    const batch = await scanBatchOf({
      userId: args.userId,
      search,
      after,
      limit: SESSION_PAGE_SCAN_BATCH,
    })
    const scanned = batch.at(-1)
    if (scanned === undefined) break
    after = { updatedAt: scanned.updatedAt, id: scanned.id }
    for (const session of batch) {
      if (sidebarBucketOf({ session, now }) !== args.bucket) continue
      kept.push(session)
      if (kept.length > limit) break
    }
  }
  const page = kept.slice(0, limit)
  const last = page.at(-1)
  const rows: LiveThreadRow[] = await liveRowsOf({ userId: args.userId, sessions: page })
  const next =
    kept.length > limit && last !== undefined
      ? cursorStringOf({ updatedAt: last.updatedAt, id: last.id })
      : undefined
  return { rows, counts, ...(next === undefined ? {} : { next }) }
}
