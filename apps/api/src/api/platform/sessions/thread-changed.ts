import { db } from '@dltech/atlas-db'
import type { Tx } from '@dltech/atlas-db'
import type { ThreadChangedSignal } from './thread-signal.bus'
import { enrichThreads } from './thread-enrichment'
import { withSessions } from './thread-with-session'

async function bumpThreadRev(args: {
  tx: Tx
  threadId: string
}): Promise<{ rev: number; userId: string } | null> {
  const statement = args.tx.raw
    .sql`UPDATE "Thread" SET "rev" = "rev" + 1 WHERE "id" = ${args.threadId} RETURNING "rev", "userId"`
    .returnsRow({ rev: 'pg/int4@1', userId: 'pg/text@1' })
    .build()
  const [row] = await args.tx.query(statement)
  return row ?? null
}

export function bumpAndEnrichThread(args: {
  threadId: string
}): Promise<ThreadChangedSignal | null> {
  const { threadId } = args
  return db.transaction(async (tx) => {
    const bumped = await bumpThreadRev({ tx, threadId })
    if (bumped === null) return null
    const row = await tx.orm.public.Thread.where({ id: threadId }).all().firstOrThrow()
    const rows = await withSessions({ reader: tx, threads: [row] })
    const [thread] = await enrichThreads({ rows, viewerId: bumped.userId })
    const session = rows[0]?.session
    if (thread === undefined || session === undefined) return null
    return {
      userId: bumped.userId,
      threadId,
      rev: bumped.rev,
      thread,
      session: {
        id: session.id,
        projectId: session.projectId,
        managedBySessionId: session.managedBySessionId,
        mainThreadId: session.mainThreadId,
        updatedAt: session.updatedAt.toISOString(),
      },
    }
  })
}
