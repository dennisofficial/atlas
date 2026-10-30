import type { EventDraftInput, SaidImageWire, SaidUploadWire } from '@dltech/atlas-wire'
import { z } from 'zod'
import { db, type Row, type Tx } from '@dltech/atlas-db'

export type FirstMessage = {
  sendId: string
  text: string
  images?: readonly SaidImageWire[] | undefined
  uploads?: readonly SaidUploadWire[] | undefined
}

export const userSaidDraftOf = (message: FirstMessage): EventDraftInput => ({
  type: 'user-said',
  body: JSON.stringify({
    type: 'user-said',
    text: message.text,
    requestId: message.sendId,
    ...(message.images === undefined || message.images.length === 0
      ? {}
      : { images: message.images }),
    ...(message.uploads === undefined || message.uploads.length === 0
      ? {}
      : { uploads: message.uploads }),
  }),
})

const requestBodySchema = z.object({ requestId: z.string() })

const requestIdOf = (body: string): string | undefined => {
  try {
    const parsed = requestBodySchema.safeParse(JSON.parse(body))
    return parsed.success ? parsed.data.requestId : undefined
  } catch {
    return undefined
  }
}

const needleOf = (sendId: string): string => `%"requestId":${JSON.stringify(sendId)}%`

export async function lockFirstMessage(args: {
  tx: Tx
  userId: string
  sendId: string
}): Promise<void> {
  const key = `first-message:${args.userId}:${args.sendId}`
  const statement = args.tx.raw.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`
    .affectedCount()
    .build()
  await args.tx.execute(statement)
}

export async function findFirstMessageThread(args: {
  reader: Pick<Tx, 'orm'>
  userId: string
  sendId: string
}): Promise<Row<'Thread'> | null> {
  const candidates = await args.reader.orm.public.Event.where({
    userId: args.userId,
    type: 'user-said',
  })
    .where((event) => event.body.like(needleOf(args.sendId)))
    .orderBy((event) => event.at.asc())
    .all()
  const threadIds = candidates
    .filter((event) => requestIdOf(event.body) === args.sendId)
    .map((event) => event.threadId)
  if (threadIds.length === 0) return null
  return args.reader.orm.public.Thread.where((thread) => thread.id.in(threadIds))
    .where({ userId: args.userId, parentThreadId: null })
    .orderBy((thread) => thread.createdAt.asc())
    .first()
}

export async function findUserSaid(args: {
  reader?: Pick<Tx, 'orm'>
  threadId: string
  sendId: string
}) {
  const reader = args.reader ?? db
  const needle = needleOf(args.sendId)
  const candidates = await reader.orm.public.Event.where({
    threadId: args.threadId,
    type: 'user-said',
  })
    .where((event) => event.body.like(needle))
    .orderBy((event) => event.seq.desc())
    .all()
  return candidates.find((event) => requestIdOf(event.body) === args.sendId) ?? null
}
