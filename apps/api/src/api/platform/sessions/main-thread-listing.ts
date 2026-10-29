import { db, or } from '@dltech/atlas-db'
import { withSessions, type ThreadWithSession } from './thread-with-session'

export const THREAD_LISTING_LIMIT = 50

export type MainThreadScope = { project: string } | { projectId: string }

export async function listMainThreads(args: {
  userId: string
  scope: MainThreadScope
  limit: number
}): Promise<ThreadWithSession[]> {
  const owned = db.orm.public.Session.where({ userId: args.userId })
  const { scope } = args
  const scoped =
    'projectId' in scope
      ? owned.where({ projectId: scope.projectId })
      : owned.where((session) =>
          or(session.repo.eq(scope.project), session.workspace.eq(scope.project)),
        )
  const sessions = await scoped
    .where((session) => session.mainThreadId.isNotNull())
    .orderBy((session) => session.updatedAt.desc())
    .limit(args.limit)
    .all()
  const mainIds = sessions.flatMap((session) => session.mainThreadId ?? [])
  const threads = await db.orm.public.Thread.where((thread) => thread.id.in(mainIds)).all()
  const order = new Map(mainIds.map((id, index) => [id, index]))
  const sorted = [...threads].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
  return withSessions({ reader: db, threads: sorted })
}
