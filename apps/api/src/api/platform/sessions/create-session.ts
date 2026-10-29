import { TEAMMATE_AGENT_TYPE } from '@dltech/atlas-wire'
import type { Row, Tx } from '@dltech/atlas-db'
import { sessionOfThread } from './session-of-thread'

export type SessionDraft = {
  id: string
  userId: string
  projectId?: string | null | undefined
  repo?: string | null | undefined
  workspace?: string | null | undefined
  executionLocation?: string | null | undefined
  title?: string | null | undefined
  managedBySessionId?: string | undefined
  createdAt: Date
  updatedAt: Date
}

type ThreadColumns = Omit<Parameters<Tx['orm']['public']['Thread']['create']>[0], 'sessionId'>

const present = <T>(key: string, value: T | null | undefined) =>
  value === undefined || value === null ? {} : { [key]: value }

export async function createSessionWithMainThread(args: {
  tx: Tx
  session: SessionDraft
  thread: ThreadColumns
}): Promise<{ session: Row<'Session'>; thread: Row<'Thread'> }> {
  const { tx, session: draft } = args
  await tx.orm.public.Session.create({
    id: draft.id,
    userId: draft.userId,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    ...present('projectId', draft.projectId),
    ...present('repo', draft.repo),
    ...present('workspace', draft.workspace),
    ...present('executionLocation', draft.executionLocation),
    ...present('title', draft.title),
    ...present('managedBySessionId', draft.managedBySessionId),
  })
  const thread = await tx.orm.public.Thread.create({ ...args.thread, sessionId: draft.id })
  await tx.orm.public.Session.where({ id: draft.id }).update({ mainThreadId: thread.id })
  const session = await tx.orm.public.Session.where({ id: draft.id }).all().firstOrThrow()
  return { session, thread }
}

export async function createDraftThread(args: {
  tx: Tx
  session: SessionDraft
  thread: ThreadColumns
  agent?: { spawnedBy: string; type: string } | undefined
}): Promise<{ session: Row<'Session'>; thread: Row<'Thread'> }> {
  const { tx, agent } = args
  if (agent === undefined) return createSessionWithMainThread(args)
  const spawnerSession = await sessionOfThread({ reader: tx, threadId: agent.spawnedBy })
  const thread = { ...args.thread, spawnerThreadId: agent.spawnedBy, agentType: agent.type }
  if (agent.type !== TEAMMATE_AGENT_TYPE) {
    const created = await tx.orm.public.Thread.create({ ...thread, sessionId: spawnerSession.id })
    return { session: spawnerSession, thread: created }
  }
  return createSessionWithMainThread({
    tx,
    thread,
    session: {
      ...args.session,
      projectId: spawnerSession.projectId,
      repo: spawnerSession.repo,
      workspace: spawnerSession.workspace,
      executionLocation: spawnerSession.executionLocation,
      managedBySessionId: spawnerSession.id,
    },
  })
}
