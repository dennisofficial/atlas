import { db, type Row } from '@dltech/atlas-db'
import { wireThreadSchema, type LiveThreadRow, type Project } from '@dltech/atlas-wire'
import { toProject } from './live-project'
import { enrichThreads } from './thread-enrichment'
import { withSessions } from './thread-with-session'

export type LiveSnapshot = { rows: LiveThreadRow[]; projects: Project[] }

export async function liveSnapshot(args: { userId: string }): Promise<LiveSnapshot> {
  const sessions = await db.orm.public.Session.where({ userId: args.userId })
    .where((session) => session.mainThreadId.isNotNull())
    .orderBy((session) => session.updatedAt.desc())
    .all()
  const rows = await liveRowsOf({ userId: args.userId, sessions })
  const projects = await listLiveProjects({ userId: args.userId })
  return { rows, projects }
}

async function listLiveProjects(args: { userId: string }): Promise<Project[]> {
  const rows = await db.orm.public.Project.where({ ownerUserId: args.userId })
    .orderBy((project) => project.createdAt.asc())
    .all()
  return rows.map((row) => toProject(row))
}

async function liveRowsOf(args: {
  userId: string
  sessions: readonly Row<'Session'>[]
}): Promise<LiveThreadRow[]> {
  const mainIds = args.sessions.flatMap((session) => session.mainThreadId ?? [])
  if (mainIds.length === 0) return []
  const threads = await db.orm.public.Thread.where((thread) => thread.id.in(mainIds)).all()
  const withSession = await withSessions({ reader: db, threads })
  const enriched = await enrichThreads({ rows: withSession, viewerId: args.userId })
  const sessionById = new Map(args.sessions.map((session) => [session.id, session]))
  const byThread = new Map(enriched.map((thread) => [thread.id, thread]))
  return withSession.flatMap(({ thread, session }) => {
    const stored = sessionById.get(session.id)
    if (stored === undefined) return []
    const dto = byThread.get(thread.id)
    if (dto === undefined) return []
    return [
      {
        sessionId: session.id,
        projectId: session.projectId,
        managedBySessionId: session.managedBySessionId,
        sortAt: session.updatedAt.toISOString(),
        rev: thread.rev,
        thread: wireThreadSchema.parse(dto),
      },
    ]
  })
}
