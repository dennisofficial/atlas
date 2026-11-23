import type { Db, Row, Tx } from '@dltech/atlas-db'
import { podSessionsOf } from '../sessions/session-of-thread'

type SessionReader = Pick<Db, 'orm'> | Tx

const liveSessions = async (args: { reader: SessionReader }): Promise<Row<'Session'>[]> =>
  await args.reader.orm.public.Session.where((session) => session.archivedAt.isNull())
    .where((session) => session.deletedAt.isNull())
    .all()

export async function livePreviewPeersOf(args: {
  reader: SessionReader
  podSessionId: string
}): Promise<number> {
  const pods = await podSessionsOf({
    reader: args.reader,
    sessions: await liveSessions({ reader: args.reader }),
  })
  return [...pods.values()].filter((pod) => pod === args.podSessionId).length
}
