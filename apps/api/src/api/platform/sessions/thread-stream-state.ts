import { db } from '@dltech/atlas-db'
import { EThreadStreamFrame, wireThreadSchema, type ThreadStreamFrame } from '@dltech/atlas-wire'
import { enrichThreads } from './thread-enrichment'
import { withSessions } from './thread-with-session'

export type ThreadMetadataFrame = Extract<ThreadStreamFrame, { type: EThreadStreamFrame.Meta }>

export async function readThreadMetadata(args: { threadId: string }): Promise<ThreadMetadataFrame> {
  const row = await db.orm.public.Thread.where({ id: args.threadId }).all().firstOrThrow()
  const rows = await withSessions({ reader: db, threads: [row] })
  const [thread] = await enrichThreads({ rows, viewerId: row.userId })
  return { type: EThreadStreamFrame.Meta, thread: wireThreadSchema.parse(thread), rev: row.rev }
}
