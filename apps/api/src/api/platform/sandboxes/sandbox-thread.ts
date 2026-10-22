import { NotFoundException } from '@nestjs/common'

import type { Db, Row, Tx } from '@dltech/atlas-db'

/**
 * A lift claims the sandbox before the thread has ever been opened on the control plane — the
 * transcript rides up separately as an archive — so the row the claim keys on does not exist yet.
 * Find-or-create it here rather than asking every client to open first: a row made this way
 * carries only the claim's metadata, and the transcript lands on top of it. A thread id that
 * already belongs to another user is still a 404, the same as ownership would answer.
 */
export async function findOrCreateClaimThread(args: {
  db: Pick<Db, 'orm'> | Tx
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
  return args.db.orm.public.Thread.create({
    id: args.threadId,
    userId: args.userId,
    createdAt: at,
    updatedAt: at,
    ...(args.workspace === undefined ? {} : { workspace: args.workspace }),
  })
}
