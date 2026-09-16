import { NotFoundException } from '@nestjs/common'
import type { CloudSandboxModel } from '../../db'
import { db } from '../../db'

export async function ownedSandbox(args: {
  userId: string
  threadId: string
}): Promise<CloudSandboxModel> {
  const row = await db.cloudSandbox.findFirst({
    where: { threadId: args.threadId, userId: args.userId },
  })
  if (row === null) throw new NotFoundException('sandbox not found')
  return row
}
