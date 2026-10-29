import { NotFoundException } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { podSessionOf } from '../sessions/session-of-thread'
import { SANDBOX_STATUS_COLUMNS, type SandboxStatusColumns } from './rows'

export async function ownedSandbox(args: {
  userId: string
  threadId: string
}): Promise<SandboxStatusColumns> {
  const sessionId = await podSessionOf({ reader: db, threadId: args.threadId })
  const row = await db.orm.public.CloudSandbox.where({
    sessionId,
    userId: args.userId,
  })
    .select(...SANDBOX_STATUS_COLUMNS)
    .first()
  if (row === null) throw new NotFoundException('sandbox not found')
  return row
}
