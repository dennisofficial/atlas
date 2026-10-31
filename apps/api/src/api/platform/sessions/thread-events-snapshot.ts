import { db } from '@dltech/atlas-db'
import type { ThreadEventsSnapshot } from '@dltech/atlas-wire'
import { NotFoundException } from '@nestjs/common'
import { readOwnRows } from './append'
import { toEventDto } from './rows'
import { lockThread } from './thread-head'

export type EventSnapshotReader = (args: {
  fromSeq?: number
  stateOnly?: boolean
}) => Promise<ThreadEventsSnapshot>

export async function readThreadEventsSnapshot(args: {
  threadId: string
  userId: string
  fromSeq?: number | undefined
  stateOnly?: boolean
}): Promise<ThreadEventsSnapshot> {
  return db.transaction(async (tx) => {
    await lockThread({ tx, threadId: args.threadId })
    const thread = await tx.orm.public.Thread.where({ id: args.threadId })
      .select('head', 'historyRev', 'userId')
      .firstOrThrow()
    if (thread.userId !== args.userId) throw new NotFoundException('thread not found')
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
