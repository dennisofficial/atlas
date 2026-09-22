import { NotFoundException } from '@nestjs/common'
import type { ThreadModel } from '../../../db'
import type { Prisma, PrismaClient } from '../../../generated/prisma/client'

type Reader = Pick<PrismaClient, 'thread'> | Prisma.TransactionClient

export async function ownedThread(args: {
  reader: Reader
  userId: string
  threadId: string
}): Promise<ThreadModel> {
  const row = await args.reader.thread.findFirst({
    where: { id: args.threadId, userId: args.userId },
  })
  if (row === null) throw new NotFoundException('thread not found')
  return row
}
