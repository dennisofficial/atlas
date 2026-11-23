import type { ControlPlane } from '@dltech/atlas-control'
import { sessionSummaryOf } from '@dltech/atlas-control'
import {
  ESessionPageBucket,
  SESSION_INACTIVE_AFTER_MS,
  type SessionBucketPageInput,
  type SessionBucketPageOutput,
} from '@dltech/atlas-protocol'
import { BadRequestException } from '@nestjs/common'

export const BUCKET_PAGE_DEFAULT_LIMIT = 20
export const BUCKET_PAGE_MAX_LIMIT = 100

const CURSOR_SEPARATOR = '|'

type BucketPagePlane = Pick<ControlPlane, 'listSessionDigests' | 'countSessionBuckets'>

type BucketCursor = { createdAt: string; sessionId: string }

const cursorStringOf = (cursor: BucketCursor): string =>
  `${cursor.createdAt}${CURSOR_SEPARATOR}${cursor.sessionId}`

function cursorOf(cursor: string): BucketCursor {
  const separator = cursor.lastIndexOf(CURSOR_SEPARATOR)
  if (separator < 0) throw new BadRequestException('invalid cursor')
  const createdAt = cursor.slice(0, separator)
  const sessionId = cursor.slice(separator + 1)
  if (sessionId.length === 0 || Number.isNaN(Date.parse(createdAt))) {
    throw new BadRequestException('invalid cursor')
  }
  return { createdAt, sessionId }
}

export async function bucketPageSessions(
  args: {
    plane: BucketPagePlane
    userId: string
    now?: number | undefined
  } & SessionBucketPageInput,
): Promise<SessionBucketPageOutput> {
  const now = args.now ?? Date.now()
  const limit = Math.min(args.limit ?? BUCKET_PAGE_DEFAULT_LIMIT, BUCKET_PAGE_MAX_LIMIT)
  const search = args.search?.trim() ?? ''
  const idleBefore = new Date(now - SESSION_INACTIVE_AFTER_MS).toISOString()
  const bucket =
    args.bucket === ESessionPageBucket.Archived
      ? { archived: true as const }
      : { archived: false as const, idleBefore }
  const after = args.cursor === undefined ? undefined : cursorOf(args.cursor)
  const digests = await args.plane.listSessionDigests({
    userId: args.userId,
    limit: limit + 1,
    bucket,
    ...(search.length === 0 ? {} : { search }),
    ...(after === undefined ? {} : { after }),
    withView: true,
  })
  const page = digests.slice(0, limit)
  const last = page.at(-1)
  const counts = await args.plane.countSessionBuckets({
    userId: args.userId,
    idleBefore,
    ...(search.length === 0 ? {} : { search }),
  })
  const next =
    digests.length > limit && last !== undefined
      ? cursorStringOf({ createdAt: last.createdAt, sessionId: last.sessionId })
      : undefined
  return {
    sessions: page.map((digest) => sessionSummaryOf({ digest, now })),
    counts,
    ...(next === undefined ? {} : { next }),
  }
}
