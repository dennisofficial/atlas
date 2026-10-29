import { ConflictException } from '@nestjs/common'
import type { PodChildRegister, PodEventsReply } from '@dltech/atlas-wire'
import { TEAMMATE_AGENT_TYPE } from '@dltech/atlas-wire'
import { db, isUniqueViolation } from '@dltech/atlas-db'
import { assertWithinSandboxFamily } from './pod-family'
import { nextSessionId } from '../sessions/append'
import { createSessionWithMainThread } from '../sessions/create-session'
import { sessionOfThread } from '../sessions/session-of-thread'
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

  const spawnerSession = await sessionOfThread({ reader: db, threadId: input.spawnedBy })
  const at = new Date()
  const threadColumns = {
    id: input.threadId,
    userId,
    createdAt: at,
    updatedAt: at,
    spawnerThreadId: input.spawnedBy,
    agentType: input.agentType,
  }
  try {
    if (input.agentType === TEAMMATE_AGENT_TYPE) {
      await db.transaction((tx) =>
        createSessionWithMainThread({
          tx,
          session: {
            id: nextSessionId(),
            userId,
            projectId: spawnerSession.projectId,
            repo: spawnerSession.repo,
            workspace: spawnerSession.workspace,
            executionLocation: spawnerSession.executionLocation,
            title: input.title,
            managedBySessionId: spawnerSession.id,
            createdAt: at,
            updatedAt: at,
          },
          thread: threadColumns,
        }),
      )
    } else {
      await db.orm.public.Thread.create({ ...threadColumns, sessionId: spawnerSession.id })
    }
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    const raced = await stored()
    if (raced !== null) return raced
    throw error
  }
  await args.signals.listChanged({ userId, threadId: input.threadId })
  return { head: 0 }
}
