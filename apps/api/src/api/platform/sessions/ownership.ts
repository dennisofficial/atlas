import { NotFoundException } from '@nestjs/common'
import type { Row } from '@dltech/atlas-db'
import type { SessionReader } from './fork-chain'

export async function ownedThread(args: {
  reader: SessionReader
  userId: string
  threadId: string
}): Promise<Row<'Thread'>> {
  const row = await args.reader.orm.public.Thread.where({
    id: args.threadId,
    userId: args.userId,
  }).first()
  if (row === null) throw new NotFoundException('thread not found')
  const session = await args.reader.orm.public.Session.where({ id: row.sessionId })
    .select('deletedAt')
    .first()
  if (session !== null && session.deletedAt !== null) {
    throw new NotFoundException('thread not found')
  }
  return row
}
