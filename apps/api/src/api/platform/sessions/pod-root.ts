import { NotFoundException } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { podSessionOf } from './session-of-thread'
import type { SessionReader } from './fork-chain'

/**
 * The thread the pod's serve answers to: the main thread of the session that owns the pod. A
 * teammate thread shares its manager's pod, so its root is the manager session's main thread.
 * When that main thread was never recorded (or points at a row that is gone), fall back to the
 * pod-owning session's oldest thread — the root a booted serve was configured with.
 */
export async function podRootThreadOf(args: {
  threadId: string
  reader?: SessionReader | undefined
}): Promise<string> {
  const reader = args.reader ?? db
  const sessionId = await podSessionOf({ reader, threadId: args.threadId })
  const session = await reader.orm.public.Session.where({ id: sessionId })
    .select('mainThreadId')
    .first()
  if (session?.mainThreadId != null) {
    const main = await reader.orm.public.Thread.where({ id: session.mainThreadId })
      .select('id')
      .first()
    if (main !== null) return main.id
  }
  const oldest = await reader.orm.public.Thread.where({ sessionId })
    .orderBy((thread) => thread.createdAt.asc())
    .first()
  if (oldest === null) {
    throw new NotFoundException('the session behind this pod has no thread')
  }
  return oldest.id
}
