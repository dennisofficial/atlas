import { db, type Tx } from '@dltech/atlas-db'
import type { ThreadEventsSnapshot } from '@dltech/atlas-wire'
import { NotFoundException } from '@nestjs/common'
import { readOwnRows } from './append'
import { toEventDto } from './rows'

export type EventSnapshotReader = (args: {
  fromSeq?: number
  stateOnly?: boolean
}) => Promise<ThreadEventsSnapshot>

export async function readOneSnapshot(tx: Tx): Promise<void> {
  await tx.execute(
    tx.raw.sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`.affectedCount().build(),
  )
}

export async function readThreadEventsSnapshot(args: {
  threadId: string
  userId: string
  fromSeq?: number | undefined
  stateOnly?: boolean
}): Promise<ThreadEventsSnapshot> {
  return db.transaction(async (tx) => {
    await readOneSnapshot(tx)
    const thread = await tx.orm.public.Thread.where({ id: args.threadId })
      .select('head', 'historyRev', 'userId')
      .first()
    if (thread === undefined || thread === null || thread.userId !== args.userId)
      throw new NotFoundException('thread not found')
    const rows =
      args.stateOnly === true
        ? []
        : await readOwnRows({
            reader: tx,
            threadId: args.threadId,
            userId: args.userId,
            fromSeq: args.fromSeq,
            upTo: thread.head,
          })
    return { head: thread.head, historyRev: thread.historyRev, events: rows.map(toEventDto) }
  })
}
