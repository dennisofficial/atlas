import { NotFoundException } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { SANDBOX_STATUS_COLUMNS, type SandboxStatusColumns } from './rows'

export async function ownedSandbox(args: {
  userId: string
  threadId: string
}): Promise<SandboxStatusColumns> {
  const row = await db.orm.public.CloudSandbox.where({
    threadId: args.threadId,
    userId: args.userId,
  })
    .select(...SANDBOX_STATUS_COLUMNS)
    .first()
  if (row === null) throw new NotFoundException('sandbox not found')
  return row
}
