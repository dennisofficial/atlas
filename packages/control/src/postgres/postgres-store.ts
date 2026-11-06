import { and, isUniqueViolation, retryOnConnectionLoss, type Db, type Tx } from '@dltech/atlas-db'
import { GENESIS_HASH, type Hash, type InboxEntry, type Lease } from '@dltech/atlas-core'
import type { SessionChange } from '@dltech/atlas-protocol'

import {
  ControlStorePort,
  SeqConflictError,
  type BlobRefWrite,
  type BlobRow,
  type BlobWrite,
  type ControlTx,
  type ReadEventsParams,
  type StoredEvent,
  type ThreadRow,
  type ControlSessionDigest,
  type ControlSessionRow,
  type SessionListParams,
} from '../port'
import {
  blobHashesPresent,
  blobReferencedIn,
  insertBlobRefRows,
  insertBlobRows,
  readBlobRow,
} from './postgres-blobs'
import { writeLeaseIn } from './postgres-leases'
import { announceIn, notifyWakeIn } from './postgres-notify'
import { hostPresentIn } from './postgres-presence'
import { sessionDigestsIn } from './postgres-digests'
import { sessionsNeedingHolderIn } from './postgres-needing-holder'
import { toInbox, toSessionRow, toStoredEvent, toThreadRow } from './postgres-rows'

class PostgresTx implements ControlTx {
  constructor(private readonly tx: Tx) {}

  async now(): Promise<string> {
    const [row] = await this.tx.query(
      this.tx.raw.sql`SELECT clock_timestamp() AS "at"`
        .returnsRow({ at: this.tx.sql.v2.V2Session.columns.createdAt })
        .build(),
    )
    if (row === undefined) throw new Error('database returned no clock reading')
    return row.at.toISOString()
  }

  async useSnapshot(): Promise<void> {
    await this.tx.execute(
      this.tx.raw.sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`.affectedCount().build(),
    )
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
      archivedAt: null,
    })
  }

  async readSession(params: { sessionId: string }): Promise<ControlSessionRow | undefined> {
    const row = await this.tx.orm.v2.V2Session.first({ id: params.sessionId })
    return row === null ? undefined : toSessionRow(row)
  }

  async setSessionArchived(params: {
    sessionId: string
    archivedAt: string | null
  }): Promise<boolean> {
    const changed = await this.tx.orm.v2.V2Session.where({ id: params.sessionId }).updateAndCount({
      archivedAt: params.archivedAt === null ? null : new Date(params.archivedAt),
    })
    return changed === 1
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
    return rows.map((row) => toSessionRow(row))
  }

  async listSessionDigests(params: SessionListParams): Promise<ControlSessionDigest[]> {
    return sessionDigestsIn({ tx: this.tx, ...params })
  }

  async sessionsNeedingHolder(params: { now: string; limit: number }): Promise<string[]> {
    return sessionsNeedingHolderIn({ tx: this.tx, ...params })
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
    return row === null ? undefined : toThreadRow(row)
  }

  async readThread(threadId: string): Promise<ThreadRow | undefined> {
    const row = await this.tx.orm.v2.V2Thread.first({ id: threadId })
    return row === null ? undefined : toThreadRow(row)
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

  async insertBlobs(rows: readonly BlobWrite[]): Promise<void> {
    await insertBlobRows(this.tx, rows)
  }

  async insertBlobRefs(rows: readonly BlobRefWrite[]): Promise<void> {
    await insertBlobRefRows(this.tx, rows)
  }

  async readBlob(params: { hash: string }): Promise<BlobRow | undefined> {
    return readBlobRow(this.tx, params.hash)
  }

  async blobsExist(hashes: readonly string[]): Promise<ReadonlySet<string>> {
    return blobHashesPresent(this.tx, hashes)
  }

  async blobReferencedBy(params: { sessionId: string; hash: string }): Promise<boolean> {
    return blobReferencedIn(this.tx, params)
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
    return rows.map(toStoredEvent)
  }

  async readLease(sessionId: string): Promise<Lease | undefined> {
    return (await this.tx.orm.v2.V2Lease.first({ sessionId })) ?? undefined
  }

  async leasesHeldBy(params: { hostId: number; limit: number }): Promise<Lease[]> {
    const rows = await this.tx.orm.v2.V2Lease.where({ holderHostId: params.hostId })
      .orderBy((l) => l.sessionId.asc())
      .limit(params.limit)
      .all()
    return rows.map((row) => ({ ...row }))
  }

  async lockLease(sessionId: string): Promise<Lease | undefined> {
    const row = await this.tx.orm.v2.V2Lease.where({ sessionId }).forNoKeyUpdate().first()
    return row ?? undefined
  }

  async shareLease(sessionId: string): Promise<Lease | undefined> {
    const row = await this.tx.orm.v2.V2Lease.where({ sessionId }).forShare().first()
    return row ?? undefined
  }

  async writeLease(params: { lease: Lease; expectedEpoch: number }): Promise<boolean> {
    return writeLeaseIn({ tx: this.tx, ...params })
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

  async readInboxEntries(params: {
    sessionId: string
    afterId: number
    limit: number
    excludeKind?: string | undefined
  }) {
    const rows = await this.tx.orm.v2.V2InboxEntry.where((e) =>
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

  async notifyWake(sessionId: string): Promise<void> {
    await notifyWakeIn({ tx: this.tx, sessionId })
  }

  async announce(change: SessionChange): Promise<void> {
    await announceIn({ tx: this.tx, change })
  }

  async hostPresent(hostId: number): Promise<boolean> {
    return hostPresentIn({ tx: this.tx, hostId })
  }
}

export class PostgresControlStore extends ControlStorePort {
  constructor(private readonly db: Db) {
    super()
  }

  transact<T>(work: (tx: ControlTx) => Promise<T>): Promise<T> {
    return retryOnConnectionLoss(() => this.db.transaction((tx) => work(new PostgresTx(tx))))
  }
}
