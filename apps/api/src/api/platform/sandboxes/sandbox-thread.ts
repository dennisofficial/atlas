import { NotFoundException } from '@nestjs/common'

import type { ThreadModel } from '../../../db'
import type { PrismaClient } from '../../../generated/prisma/client'
import { nowIso } from '../sessions/append'

/**
 * A lift claims the sandbox before the thread has ever been opened on the control plane — the
 * transcript rides up separately as an archive — so the row the claim keys on does not exist yet.
 * Find-or-create it here rather than asking every client to open first: a row made this way
 * carries only the claim's metadata, and the transcript lands on top of it. A thread id that
 * already belongs to another user is still a 404, the same as ownership would answer.
 */
export async function findOrCreateClaimThread(args: {
  db: PrismaClient
  userId: string
  threadId: string
  workspace?: string | undefined
}): Promise<ThreadModel> {
  const existing = await args.db.thread.findUnique({ where: { id: args.threadId } })
  if (existing !== null) {
    if (existing.userId !== args.userId) throw new NotFoundException('thread not found')
    return existing
  }

  const at = nowIso()
  return args.db.thread.create({
    data: {
      id: args.threadId,
      userId: args.userId,
      createdAt: at,
      updatedAt: at,
      ...(args.workspace === undefined ? {} : { workspace: args.workspace }),
    },
  })
}
