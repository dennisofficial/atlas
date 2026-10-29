import type { Row } from '@dltech/atlas-db'
import type { SessionReader } from './fork-chain'

export type ThreadWithSession = { thread: Row<'Thread'>; session: Row<'Session'> }

export async function withSessions(args: {
  reader: SessionReader
  threads: readonly Row<'Thread'>[]
}): Promise<ThreadWithSession[]> {
  const ids = [...new Set(args.threads.map((thread) => thread.sessionId))]
  if (ids.length === 0) return []
  const sessions = await args.reader.orm.public.Session.where((session) => session.id.in(ids)).all()
  const byId = new Map(sessions.map((session) => [session.id, session]))
  return args.threads.flatMap((thread) => {
    const session = byId.get(thread.sessionId)
    return session === undefined ? [] : [{ thread, session }]
  })
}
