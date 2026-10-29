import { NotFoundException } from '@nestjs/common'

import type { Db, Row } from '@dltech/atlas-db'
import { nextSessionId } from '../sessions/append'
import { createSessionWithMainThread } from '../sessions/create-session'

/**
 * A lift claims the sandbox before the thread has ever been opened on the control plane — the
 * transcript rides up separately as an archive — so the row the claim keys on does not exist yet.
 * Find-or-create it here rather than asking every client to open first: a row made this way
 * carries only the claim's metadata, and the transcript lands on top of it. A thread id that
 * already belongs to another user is still a 404, the same as ownership would answer.
 */
export async function findOrCreateClaimThread(args: {
  db: Db
  userId: string
  threadId: string
  workspace?: string | undefined
}): Promise<Row<'Thread'>> {
  const existing = await args.db.orm.public.Thread.where({ id: args.threadId }).first()
  if (existing !== null) {
    if (existing.userId !== args.userId) throw new NotFoundException('thread not found')
    return existing
  }

  const at = new Date()
  return args.db.transaction(async (tx) => {
    const { thread } = await createSessionWithMainThread({
      tx,
      session: {
        id: nextSessionId(),
        userId: args.userId,
        workspace: args.workspace,
        createdAt: at,
        updatedAt: at,
      },
      thread: { id: args.threadId, userId: args.userId, createdAt: at, updatedAt: at },
    })
    return thread
  })
}
