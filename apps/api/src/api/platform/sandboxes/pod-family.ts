import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { db } from '@dltech/atlas-db'

const MAX_FAMILY_DEPTH = 16

export async function assertWithinSandboxFamily(args: {
  rootThreadId: string
  userId: string
  threadId: string | undefined
}): Promise<string> {
  const { rootThreadId, userId } = args
  const target = args.threadId ?? rootThreadId
  let cursor: string = target
  for (let hop = 0; hop <= MAX_FAMILY_DEPTH; hop += 1) {
    if (cursor === rootThreadId) {
      if (cursor === target) return target
      const row = await db.orm.public.Thread.where({ id: target }).select('userId').first()
      if (row === null) throw new NotFoundException('thread not found')
      if (row.userId !== userId) throw new ForbiddenException('thread belongs to another user')
      return target
    }
    const row = await db.orm.public.Thread.where({ id: cursor }).select('spawnerThreadId').first()
    if (row === null) throw new NotFoundException('thread not found')
    if (row.spawnerThreadId === null) break
    cursor = row.spawnerThreadId
  }
  throw new ForbiddenException('the sandbox token reaches only its own thread family')
}
