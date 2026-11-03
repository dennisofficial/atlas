import { and, isUniqueViolation, type Db, type Tx } from '@dltech/atlas-db'
import { GENESIS_HASH, type Hash, type InboxEntry, type Lease } from '@dltech/atlas-core'

import {
  ControlStorePort,
  SeqConflictError,
  type ControlTx,
  type ReadEventsParams,
  type StoredEvent,
  type ThreadRow,
  type ControlSessionRow,
} from '../port'

const iso = (value: Date): string => value.toISOString()

const toInbox = (row: {
  sessionId: string
  inboxId: number
  kind: string
  payload: string
  postedAt: Date
  consumedSeq: number | null
}): InboxEntry => ({ ...row, postedAt: iso(row.postedAt) })

class PostgresTx implements ControlTx {
  constructor(private readonly tx: Tx) {}

  async now(): Promise<string> {
    const [row] = await this.tx.query(
      this.tx.raw.sql`SELECT clock_timestamp() AS "at"`
        .returnsRow({
          at: this.tx.sql.v2.V2Lease.columns.renewedAt,
        })
        .build(),
    )
    if (row === undefined) throw new Error('database returned no clock reading')
    return row.at.toISOString()
  }

  async createSession(params: {
    sessionId: string
    userId: string
    projectId: string
    title?: string | undefined
    mainThreadId: string
    at: string
  }): Promise<void> {
    await this.tx.orm.v2.V2Session.create({
      id: params.sessionId,
      userId: params.userId,
      projectId: params.projectId,
      title: params.title ?? null,
      mainThreadId: params.mainThreadId,
      nextInboxId: 1,
      createdAt: new Date(params.at),
    })
  }

  async readSession(params: { sessionId: string }): Promise<ControlSessionRow | undefined> {
    const row = await this.tx.orm.v2.V2Session.first({ id: params.sessionId })
    return row === null ? undefined : this.toSessionRow(row)
  }

  async listSessions(params: {
    userId: string
    projectId?: string | undefined
    limit: number
  }): Promise<ControlSessionRow[]> {
    const where =
      params.projectId === undefined
        ? { userId: params.userId }
        : { userId: params.userId, projectId: params.projectId }
    const rows = await this.tx.orm.v2.V2Session.where(where)
      .orderBy((s) => s.createdAt.desc())
      .limit(params.limit)
      .all()
    return rows.map((row) => this.toSessionRow(row))
  }

  private toSessionRow(row: {
    id: string
    userId: string
    projectId: string
    title: string | null
    mainThreadId: string
    createdAt: Date
  }): ControlSessionRow {
    return {
      sessionId: row.id,
      userId: row.userId,
      projectId: row.projectId,
      title: row.title,
      mainThreadId: row.mainThreadId,
      createdAt: iso(row.createdAt),
    }
  }

  async sessionsNeedingHolder(params: { now: string; limit: number }): Promise<string[]> {
    const rows = await this.tx.query(
      this.tx.raw.sql`SELECT s."id" FROM "v2"."V2Session" s
        LEFT JOIN "v2"."V2Lease" l ON l."sessionId" = s."id"
        WHERE (l."sessionId" IS NULL OR l."holderId" IS NULL
            OR l."renewedAt" + make_interval(secs => l."ttlMs" / 1000.0) <= ${params.now}::timestamptz)
          AND (l."holderId" IS NOT NULL OR l."wantsHolder"
            OR EXISTS (SELECT 1 FROM "v2"."V2InboxEntry" i
              WHERE i."sessionId" = s."id" AND i."consumedSeq" IS NULL))
        ORDER BY s."createdAt" ASC, s."id" ASC
        LIMIT ${params.limit}`
        .returnsRow({ id: 'pg/text@1' })
        .build(),
    )
    return rows.map((row) => row.id)
  }

  async createThread(params: {
    threadId: string
    sessionId: string
    visibility: string
    at: string
  }): Promise<void> {
    await this.tx.orm.v2.V2Thread.create({
      id: params.threadId,
      sessionId: params.sessionId,
      headSeq: 0,
      headHash: GENESIS_HASH,
      visibility: params.visibility,
      createdAt: new Date(params.at),
    })
  }

  async lockThread(threadId: string): Promise<ThreadRow | undefined> {
    const row = await this.tx.orm.v2.V2Thread.where({ id: threadId }).forNoKeyUpdate().first()
    return row === null ? undefined : this.toThreadRow(row)
  }

  async readThread(threadId: string): Promise<ThreadRow | undefined> {
    const row = await this.tx.orm.v2.V2Thread.first({ id: threadId })
    return row === null ? undefined : this.toThreadRow(row)
  }

  private toThreadRow(row: {
    id: string
    sessionId: string
    headSeq: number
    headHash: string
    visibility: string
  }): ThreadRow {
    return {
      threadId: row.id,
      sessionId: row.sessionId,
      headSeq: row.headSeq,
      headHash: row.headHash as Hash,
      visibility: row.visibility,
    }
  }

  async writeThreadHead(params: {
    threadId: string
    expectedHeadSeq: number
    headSeq: number
    headHash: Hash
    visibility: string
  }): Promise<boolean> {
    const changed = await this.tx.orm.v2.V2Thread.where({
      id: params.threadId,
      headSeq: params.expectedHeadSeq,
    }).updateAndCount({
      headSeq: params.headSeq,
      headHash: params.headHash,
      visibility: params.visibility,
    })
    return changed === 1
  }

  async insertEvents(rows: readonly StoredEvent[]): Promise<void> {
    try {
      await this.tx.orm.v2.V2Event.createAndCount(
        rows.map((row) => ({ ...row, at: new Date(row.at) })),
      )
    } catch (error) {
      if (isUniqueViolation(error)) throw new SeqConflictError()
      throw error
    }
  }

  async readEvents(params: ReadEventsParams): Promise<StoredEvent[]> {
    const { onlyTypes } = params
    let query = this.tx.orm.v2.V2Event.where((e) =>
      and(e.threadId.eq(params.threadId), e.seq.gt(params.afterSeq), e.seq.lte(params.throughSeq)),
    )
    if (onlyTypes !== undefined) query = query.where((e) => e.type.in([...onlyTypes]))
    const rows = await query
      .orderBy((e) => e.seq.asc())
      .limit(params.limit)
      .all()
    return rows.map((row) => ({
      threadId: row.threadId,
      seq: row.seq,
      id: row.id,
      epoch: row.epoch,
      type: row.type,
      runId: row.runId,
      at: iso(row.at),
      prevHash: row.prevHash as Hash,
      hash: row.hash as Hash,
      canonical: row.canonical,
    }))
  }

  async readLease(sessionId: string): Promise<Lease | undefined> {
    const row = await this.tx.orm.v2.V2Lease.first({ sessionId })
    return row === null ? undefined : { ...row, renewedAt: iso(row.renewedAt) }
  }

  async lockLease(sessionId: string): Promise<Lease | undefined> {
    const row = await this.tx.orm.v2.V2Lease.where({ sessionId }).forNoKeyUpdate().first()
    return row === null ? undefined : { ...row, renewedAt: iso(row.renewedAt) }
  }

  async writeLease(params: { lease: Lease; expectedEpoch: number }): Promise<boolean> {
    const { lease } = params
    const existing = await this.tx.orm.v2.V2Lease.first({ sessionId: lease.sessionId })
    const data = {
      epoch: lease.epoch,
      holderId: lease.holderId,
      renewedAt: new Date(lease.renewedAt),
      ttlMs: lease.ttlMs,
      wantsHolder: lease.wantsHolder,
    }
    if (existing === null) {
      if (params.expectedEpoch !== 0) return false
      try {
        await this.tx.orm.v2.V2Lease.create({ sessionId: lease.sessionId, ...data })
      } catch (error) {
        if (isUniqueViolation(error)) return false
        throw error
      }
      return true
    }
    const changed = await this.tx.orm.v2.V2Lease.where({
      sessionId: lease.sessionId,
      epoch: params.expectedEpoch,
    }).updateAndCount(data)
    return changed === 1
  }

  async allocateInboxId(sessionId: string): Promise<number> {
    const session = await this.tx.orm.v2.V2Session.where({ id: sessionId }).forNoKeyUpdate().first()
    if (session === null) throw new Error(`unknown session ${sessionId}`)
    await this.tx.orm.v2.V2Session.where({ id: sessionId }).updateAndCount({
      nextInboxId: session.nextInboxId + 1,
    })
    return session.nextInboxId
  }

  async insertInboxEntry(entry: InboxEntry): Promise<void> {
    await this.tx.orm.v2.V2InboxEntry.create({ ...entry, postedAt: new Date(entry.postedAt) })
  }

  async readInboxEntry(params: { sessionId: string; inboxId: number }) {
    const row = await this.tx.orm.v2.V2InboxEntry.first(params)
    return row === null ? undefined : toInbox(row)
  }

  async markInboxConsumed(params: {
    sessionId: string
    inboxId: number
    seq: number
  }): Promise<boolean> {
    const changed = await this.tx.orm.v2.V2InboxEntry.where((e) =>
      and(e.sessionId.eq(params.sessionId), e.inboxId.eq(params.inboxId), e.consumedSeq.isNull()),
    ).updateAndCount({ consumedSeq: params.seq })
    return changed === 1
  }

  async deleteInboxEntry(params: { sessionId: string; inboxId: number }): Promise<boolean> {
    const changed = await this.tx.orm.v2.V2InboxEntry.where((e) =>
      and(e.sessionId.eq(params.sessionId), e.inboxId.eq(params.inboxId), e.consumedSeq.isNull()),
    ).deleteAndCount()
    return changed === 1
  }

  async readInboxEntries(params: { sessionId: string; afterId: number; limit: number }) {
    const rows = await this.tx.orm.v2.V2InboxEntry.where((e) =>
      and(e.sessionId.eq(params.sessionId), e.inboxId.gt(params.afterId), e.consumedSeq.isNull()),
    )
      .orderBy((e) => e.inboxId.asc())
      .limit(params.limit)
      .all()
    return rows.map(toInbox)
  }
}

export class PostgresControlStore extends ControlStorePort {
  constructor(private readonly db: Db) {
    super()
  }

  transact<T>(work: (tx: ControlTx) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => work(new PostgresTx(tx)))
  }
}
