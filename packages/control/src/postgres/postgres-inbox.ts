import { and, type Tx } from '@dltech/atlas-db'
import { EInputKind, type InboxEntry, type ThreadId } from '@dltech/atlas-core'

import { toInbox } from './postgres-rows'

export const allocateInboxIdIn = async (params: { tx: Tx; sessionId: string }): Promise<number> => {
  const { tx, sessionId } = params
  const session = await tx.orm.v2.V2Session.where({ id: sessionId }).forNoKeyUpdate().first()
  if (session === null) throw new Error(`unknown session ${sessionId}`)
  await tx.orm.v2.V2Session.where({ id: sessionId }).updateAndCount({
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

export const readInboxEntryIn = async (params: {
  tx: Tx
  sessionId: string
  inboxId: number
}): Promise<InboxEntry | undefined> => {
  const row = await params.tx.orm.v2.V2InboxEntry.first({
    sessionId: params.sessionId,
    inboxId: params.inboxId,
  })
  return row === null ? undefined : toInbox(row)
}

export const markInboxConsumedIn = async (params: {
  tx: Tx
  sessionId: string
  inboxId: number
  seq: number
}): Promise<boolean> => {
  const changed = await params.tx.orm.v2.V2InboxEntry.where((e) =>
    and(e.sessionId.eq(params.sessionId), e.inboxId.eq(params.inboxId), e.consumedSeq.isNull()),
  ).updateAndCount({ consumedSeq: params.seq })
  return changed === 1
}

export const deleteInboxEntryIn = async (params: {
  tx: Tx
  sessionId: string
  inboxId: number
}): Promise<boolean> => {
  const changed = await params.tx.orm.v2.V2InboxEntry.where((e) =>
    and(e.sessionId.eq(params.sessionId), e.inboxId.eq(params.inboxId)),
  ).deleteAndCount()
  return changed === 1
}

export const readInboxEntriesIn = async (params: {
  tx: Tx
  sessionId: string
  afterId: number
  limit: number
  excludeKind?: string | undefined
  forThread: ThreadId | null
}): Promise<InboxEntry[]> => {
  const rows = await params.tx.orm.v2.V2InboxEntry.where((e) =>
    and(
      e.sessionId.eq(params.sessionId),
      e.inboxId.gt(params.afterId),
      e.consumedSeq.isNull(),
      params.forThread === null ? e.threadId.isNull() : e.threadId.eq(params.forThread),
      ...(params.excludeKind === undefined ? [] : [e.kind.neq(params.excludeKind)]),
    ),
  )
    .orderBy((e) => e.inboxId.asc())
    .limit(params.limit)
    .all()
  return rows.map(toInbox)
}

export const firstUnconsumedMessagesIn = async (params: {
  tx: Tx
  sessionIds: readonly string[]
}): Promise<InboxEntry[]> => {
  if (params.sessionIds.length === 0) return []
  const rows = await params.tx.orm.v2.V2InboxEntry.where((entry) =>
    and(
      entry.sessionId.in([...params.sessionIds]),
      entry.consumedSeq.isNull(),
      entry.kind.eq(EInputKind.Message),
      entry.threadId.isNull(),
    ),
  )
    .orderBy((entry) => entry.inboxId.asc())
    .all()
  const first = new Map<string, InboxEntry>()
  for (const row of rows) {
    if (first.has(row.sessionId)) continue
    first.set(row.sessionId, toInbox(row))
  }
  return [...first.values()]
}

export const recentInboxEntriesIn = async (params: {
  tx: Tx
  sessionId: string
  limit: number
  forThread: ThreadId | null
}): Promise<InboxEntry[]> => {
  const rows = await params.tx.orm.v2.V2InboxEntry.where((e) =>
    and(
      e.sessionId.eq(params.sessionId),
      params.forThread === null ? e.threadId.isNull() : e.threadId.eq(params.forThread),
    ),
  )
    .orderBy((e) => e.inboxId.desc())
    .limit(params.limit)
    .all()
  return rows.map(toInbox)
}
