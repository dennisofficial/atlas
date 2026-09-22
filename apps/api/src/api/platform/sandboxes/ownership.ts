import { NotFoundException } from '@nestjs/common'
import { db } from '../../../db'
import { SANDBOX_STATUS_SELECT, type SandboxStatusColumns } from './rows'

export async function ownedSandbox(args: {
  userId: string
  threadId: string
}): Promise<SandboxStatusColumns> {
  const row = await db.cloudSandbox.findFirst({
    where: { threadId: args.threadId, userId: args.userId },
    select: SANDBOX_STATUS_SELECT,
  })
  if (row === null) throw new NotFoundException('sandbox not found')
  return row
}
