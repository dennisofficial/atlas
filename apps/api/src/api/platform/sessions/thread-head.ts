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

export async function lockThread(args: { tx: Tx; threadId: string }): Promise<void> {
  const statement = args.tx.raw
    .sql`SELECT "id" FROM "Thread" WHERE "id" = ${args.threadId} FOR UPDATE`
    .returnsRow({ id: 'pg/text@1' })
    .build()
  const [row] = await args.tx.query(statement)
  if (row === undefined) throw new NotFoundException('thread not found')
}

export async function retreatHead(args: { tx: Tx; threadId: string; at: Date }): Promise<void> {
  const statement = args.tx.raw
    .sql`UPDATE "Thread" SET "head" = "head" - 1, "updatedAt" = ${args.at.toISOString()}::timestamptz WHERE "id" = ${args.threadId}`
    .affectedCount()
    .build()
  await args.tx.execute(statement)
}
