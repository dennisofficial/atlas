import { NotFoundException } from '@nestjs/common'
import type { Row } from '@dltech/atlas-db'
import type { SessionReader } from './fork-chain'

/**
 * `sessionLive` is set by a caller whose bearer already proved the thread's session is not
 * soft-deleted — a sandbox token's own thread, whose lookup joined `Session` and filtered
 * `deletedAt`. The read below would only re-establish what that join returned.
 */
export async function ownedThread(args: {
  reader: SessionReader
  userId: string
  threadId: string
  sessionLive?: boolean | undefined
}): Promise<Row<'Thread'>> {
  const row = await args.reader.orm.public.Thread.where({
    id: args.threadId,
    userId: args.userId,
  }).first()
  if (row === null) throw new NotFoundException('thread not found')
  if (args.sessionLive === true) return row
  const session = await args.reader.orm.public.Session.where({ id: row.sessionId })
    .select('deletedAt')
    .first()
  if (session !== null && session.deletedAt !== null) {
    throw new NotFoundException('thread not found')
  }
  return row
}
