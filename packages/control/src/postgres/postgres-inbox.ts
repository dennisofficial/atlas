import { and, type Tx } from '@dltech/atlas-db'
import type { InboxEntry } from '@dltech/atlas-core'

import { toInbox } from './postgres-rows'

type InboxKey = { sessionId: string; inboxId: number }

export const allocateInboxIdIn = async (params: { tx: Tx; sessionId: string }): Promise<number> => {
  const sessions = params.tx.orm.v2.V2Session
  const session = await sessions.where({ id: params.sessionId }).forNoKeyUpdate().first()
  if (session === null) throw new Error(`unknown session ${params.sessionId}`)
  await sessions.where({ id: params.sessionId }).updateAndCount({
    nextInboxId: session.nextInboxId + 1,
  })
  return session.nextInboxId
}

export const insertInboxEntryIn = async (params: { tx: Tx; entry: InboxEntry }): Promise<void> => {
  await params.tx.orm.v2.V2InboxEntry.create({
    ...params.entry,
    postedAt: new Date(params.entry.postedAt),
  })
}

export const readInboxEntryIn = async (
  params: { tx: Tx } & InboxKey,
): Promise<InboxEntry | undefined> => {
  const row = await params.tx.orm.v2.V2InboxEntry.first({
    sessionId: params.sessionId,
    inboxId: params.inboxId,
  })
  return row === null ? undefined : toInbox(row)
}

const unconsumed = (params: { tx: Tx } & InboxKey) =>
  params.tx.orm.v2.V2InboxEntry.where((e) =>
    and(e.sessionId.eq(params.sessionId), e.inboxId.eq(params.inboxId), e.consumedSeq.isNull()),
  )

export const markInboxConsumedIn = async (
  params: { tx: Tx; seq: number } & InboxKey,
): Promise<boolean> => (await unconsumed(params).updateAndCount({ consumedSeq: params.seq })) === 1

export const deleteInboxEntryIn = async (params: { tx: Tx } & InboxKey): Promise<boolean> =>
  (await unconsumed(params).deleteAndCount()) === 1

export const readInboxEntriesIn = async (params: {
  tx: Tx
  sessionId: string
  afterId: number
  limit: number
  excludeKind?: string | undefined
}): Promise<InboxEntry[]> => {
  const rows = await params.tx.orm.v2.V2InboxEntry.where((e) =>
    and(
      e.sessionId.eq(params.sessionId),
      e.inboxId.gt(params.afterId),
      e.consumedSeq.isNull(),
      ...(params.excludeKind === undefined ? [] : [e.kind.neq(params.excludeKind)]),
    ),
  )
    .orderBy((e) => e.inboxId.asc())
    .limit(params.limit)
    .all()
  return rows.map(toInbox)
}
