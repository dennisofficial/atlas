import { ConflictException } from '@nestjs/common'
import type { PodChildRegister, PodEventsReply } from '@dltech/atlas-wire'
import { db, isUniqueViolation } from '@dltech/atlas-db'
import { assertWithinSandboxFamily } from './pod-family'
import type { ThreadSignalPublisher } from '../sessions/thread-signals.service'

export async function registerPodChild(args: {
  rootThreadId: string
  userId: string
  input: PodChildRegister
  signals: Pick<ThreadSignalPublisher, 'listChanged'>
}): Promise<PodEventsReply> {
  const { rootThreadId, userId, input } = args
  await assertWithinSandboxFamily({ rootThreadId, userId, threadId: input.spawnedBy })

  const stored = async (): Promise<PodEventsReply | null> => {
    const row = await db.orm.public.Thread.where({ id: input.threadId })
      .select('userId', 'spawnerThreadId', 'head')
      .first()
    if (row === null) return null
    if (row.userId !== userId || row.spawnerThreadId !== input.spawnedBy) {
      throw new ConflictException('thread is already registered under a different spawner')
    }
    return { head: row.head }
  }

  const existing = await stored()
  if (existing !== null) return existing

  const root = await db.orm.public.Thread.where({ id: rootThreadId })
    .select('workspace', 'repo', 'projectId', 'executionLocation')
    .first()
  const at = new Date()
  try {
    await db.orm.public.Thread.create({
      id: input.threadId,
      userId,
      createdAt: at,
      updatedAt: at,
      spawnerThreadId: input.spawnedBy,
      agentType: input.agentType,
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(root?.workspace == null ? {} : { workspace: root.workspace }),
      ...(root?.repo == null ? {} : { repo: root.repo }),
      ...(root?.projectId == null ? {} : { projectId: root.projectId }),
      ...(root?.executionLocation == null ? {} : { executionLocation: root.executionLocation }),
    })
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    const raced = await stored()
    if (raced !== null) return raced
    throw error
  }
  await args.signals.listChanged({ userId, threadId: input.threadId })
  return { head: 0 }
}
