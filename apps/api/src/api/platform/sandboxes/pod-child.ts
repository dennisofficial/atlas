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
  signals: Pick<ThreadSignalPublisher, 'threadChanged'>
}): Promise<PodEventsReply> {
  const { rootThreadId, userId, input } = args
  await assertWithinSandboxFamily({ rootThreadId, userId, threadId: input.spawnedBy })

  const stored = async (): Promise<(PodEventsReply & { sessionId: string }) | null> => {
    const row = await db.orm.public.Thread.where({ id: input.threadId })
      .select('userId', 'spawnerThreadId', 'head', 'sessionId')
      .first()
    if (row === null) return null
    if (row.userId !== userId || row.spawnerThreadId !== input.spawnedBy) {
      throw new ConflictException('thread is already registered under a different spawner')
    }
    return { head: row.head, sessionId: row.sessionId }
  }

  const existing = await stored()
  if (existing !== null) {
    if (await backfillTeammateTitle({ input, sessionId: existing.sessionId })) {
      args.signals.threadChanged({ threadId: input.threadId })
    }
    return { head: existing.head }
  }

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
    if (raced !== null) return { head: raced.head }
    throw error
  }
  args.signals.threadChanged({ threadId: input.threadId })
  return { head: 0 }
}

async function backfillTeammateTitle(args: {
  input: PodChildRegister
  sessionId: string
}): Promise<boolean> {
  const { input, sessionId } = args
  if (input.agentType !== TEAMMATE_AGENT_TYPE || input.title === undefined) return false
  const session = await db.orm.public.Session.where({ id: sessionId }).select('title').first()
  if (session === null || session.title !== null) return false
  await db.orm.public.Session.where({ id: sessionId })
    .select('id')
    .update({ title: input.title, updatedAt: new Date() })
  return true
}
