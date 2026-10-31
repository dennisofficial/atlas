import { NotFoundException } from '@nestjs/common'
import type { Tx } from '@dltech/atlas-db'
import { lockThread } from './thread-head'

export async function bumpHistoryRevision(args: { tx: Tx; threadId: string }): Promise<number> {
  await lockThread(args)
  const statement = args.tx.raw
    .sql`UPDATE "Thread" SET "historyRev" = "historyRev" + 1 WHERE "id" = ${args.threadId} RETURNING "historyRev"`
    .returnsRow({ historyRev: 'pg/int4@1' })
    .build()
  const [row] = await args.tx.query(statement)
  if (row === undefined) throw new NotFoundException('thread not found')
  return row.historyRev
}
