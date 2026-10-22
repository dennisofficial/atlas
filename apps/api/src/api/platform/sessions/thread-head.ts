import { NotFoundException } from '@nestjs/common'
import type { Tx } from '@dltech/atlas-db'

export async function advanceHead(args: {
  tx: Tx
  threadId: string
  by: number
  at: Date
}): Promise<number> {
  const statement = args.tx.raw
    .sql`UPDATE "Thread" SET "head" = "head" + ${args.by}, "updatedAt" = ${args.at.toISOString()}::timestamptz WHERE "id" = ${args.threadId} RETURNING "head"`
    .returnsRow({ head: 'pg/int4@1' })
    .build()
  const [row] = await args.tx.query(statement)
  if (row === undefined) throw new NotFoundException('thread not found')
  return row.head
}
