import { retryOnConnectionLoss, type Db, type Tx } from '@dltech/atlas-db'
import { GENESIS_HASH, type InboxEntry, type Lease } from '@dltech/atlas-core'
import type { SessionChange } from '@dltech/atlas-protocol'

import {
  ControlStorePort,
  type BlobRefWrite,
  type BlobRow,
  type BlobWrite,
  type ClaimedBatch,
  type ControlTx,
  type ReadEventsParams,
  type StoredEvent,
  type ThreadRow,
  type ControlSessionRow,
  type PrStateRow,
  type PrSubscriptionLease,
  type SessionDigestRow,
  type SessionListParams,
  type SessionPullRequestKey,
  type SessionPullRequestRow,
  type SessionViewRow,
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
import { podPeersPlacedIn } from './postgres-peers'
import {
  clearTitleFromIn,
  createSessionIn,
  readSessionIn,
  setSessionArchivedIn,
  setSessionTitleIfUntitledIn,
  setSessionTitleIn,
} from './postgres-session-writes'
import { claimNeedingIn } from './postgres-claim-next'
import {
  allocateInboxIdIn,
  deleteInboxEntryIn,
  insertInboxEntryIn,
  markInboxConsumedIn,
  readInboxEntriesIn,
  readInboxEntryIn,
} from './postgres-inbox'
import {
  insertSessionPullRequestsIn,
  readPrStatesIn,
  readSessionViewIn,
  sessionsLinkedToIn,
  writeSessionViewIn,
} from './postgres-views'
import { deletePrSubscriptionLeaseIn, upsertPrSubscriptionLeaseIn } from './postgres-subscriptions'
import { toLease, toThreadRow } from './postgres-rows'
import { insertEventsIn, listSessionsIn, readEventsIn, writeThreadHeadIn } from './postgres-threads'

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
    modelRef?: string | undefined
    modelEffort?: string | undefined
    modelFast?: boolean | undefined
    at: string
  }): Promise<void> {
    await createSessionIn({ tx: this.tx, ...params })
  }

  async readSession(params: { sessionId: string }): Promise<ControlSessionRow | undefined> {
    return readSessionIn({ tx: this.tx, sessionId: params.sessionId, lock: false })
  }

  async lockSession(sessionId: string): Promise<ControlSessionRow | undefined> {
    return readSessionIn({ tx: this.tx, sessionId, lock: true })
  }

  async setSessionArchived(params: { sessionId: string; archivedAt: string | null }) {
    return setSessionArchivedIn({ tx: this.tx, ...params })
  }

  async setSessionTitleIfUntitled(params: {
    sessionId: string
    title: string
    fromInboxId: number | null
  }) {
    return setSessionTitleIfUntitledIn({ tx: this.tx, ...params })
  }

  async setSessionTitle(params: { sessionId: string; title: string }) {
    return setSessionTitleIn({ tx: this.tx, ...params })
  }

  async clearTitleFrom(params: { sessionId: string; inboxId: number }) {
    return clearTitleFromIn({ tx: this.tx, ...params })
  }

  async listSessions(params: {
    userId: string
    projectId?: string | undefined
    limit: number
  }): Promise<ControlSessionRow[]> {
    return listSessionsIn({ tx: this.tx, ...params })
  }

  async listSessionDigests(params: SessionListParams): Promise<SessionDigestRow[]> {
    return sessionDigestsIn({ tx: this.tx, ...params })
  }

  async podPeersPlaced(params: {
    podSessionId: string
    excludeSessionId: string
  }): Promise<number> {
    return podPeersPlacedIn({ tx: this.tx, ...params })
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

  async writeThreadHead(params: Parameters<ControlTx['writeThreadHead']>[0]): Promise<boolean> {
    return writeThreadHeadIn({ tx: this.tx, ...params })
  }

  async insertEvents(rows: readonly StoredEvent[]): Promise<void> {
    await insertEventsIn({ tx: this.tx, rows })
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
    return readEventsIn({ tx: this.tx, ...params })
  }

  async readLease(sessionId: string): Promise<Lease | undefined> {
    const row = await this.tx.orm.v2.V2Lease.first({ sessionId })
    return row === null ? undefined : toLease(row)
  }

  async leasesHeldBy(params: { hostId: number; limit: number }): Promise<Lease[]> {
    const rows = await this.tx.orm.v2.V2Lease.where({ holderHostId: params.hostId })
      .orderBy((l) => l.sessionId.asc())
      .limit(params.limit)
      .all()
    return rows.map(toLease)
  }

  async lockLease(sessionId: string): Promise<Lease | undefined> {
    const row = await this.tx.orm.v2.V2Lease.where({ sessionId }).forNoKeyUpdate().first()
    return row === null ? undefined : toLease(row)
  }

  async shareLease(sessionId: string): Promise<Lease | undefined> {
    const row = await this.tx.orm.v2.V2Lease.where({ sessionId }).forShare().first()
    return row === null ? undefined : toLease(row)
  }

  async claimNeeding(params: {
    hostId: number
    now: string
    limit: number
  }): Promise<ClaimedBatch> {
    return claimNeedingIn({ tx: this.tx, ...params })
  }

  async writeLease(params: { lease: Lease; expectedEpoch: number }): Promise<boolean> {
    return writeLeaseIn({ tx: this.tx, ...params })
  }

  async allocateInboxId(sessionId: string): Promise<number> {
    return allocateInboxIdIn({ tx: this.tx, sessionId })
  }

  async insertInboxEntry(entry: InboxEntry): Promise<void> {
    await insertInboxEntryIn({ tx: this.tx, entry })
  }

  async readInboxEntry(params: { sessionId: string; inboxId: number }) {
    return readInboxEntryIn({ tx: this.tx, ...params })
  }

  async markInboxConsumed(params: {
    sessionId: string
    inboxId: number
    seq: number
  }): Promise<boolean> {
    return markInboxConsumedIn({ tx: this.tx, ...params })
  }

  async deleteInboxEntry(params: { sessionId: string; inboxId: number }): Promise<boolean> {
    return deleteInboxEntryIn({ tx: this.tx, ...params })
  }

  async readInboxEntries(params: {
    sessionId: string
    afterId: number
    limit: number
    excludeKind?: string | undefined
  }) {
    return readInboxEntriesIn({ tx: this.tx, ...params })
  }

  async notifyWake(sessionId: string): Promise<void> {
    await notifyWakeIn({ tx: this.tx, sessionId })
  }

  async announce(change: SessionChange): Promise<void> {
    await announceIn({ tx: this.tx, change })
  }

  async readSessionView(sessionId: string): Promise<SessionViewRow | undefined> {
    return readSessionViewIn({ tx: this.tx, sessionId })
  }

  async writeSessionView(row: SessionViewRow): Promise<void> {
    await writeSessionViewIn({ tx: this.tx, row })
  }

  async insertSessionPullRequests(rows: readonly SessionPullRequestRow[]): Promise<void> {
    await insertSessionPullRequestsIn({ tx: this.tx, rows })
  }

  async sessionsLinkedTo(key: SessionPullRequestKey): Promise<string[]> {
    return sessionsLinkedToIn({ tx: this.tx, ...key })
  }

  async readPrStates(keys: readonly SessionPullRequestKey[]): Promise<PrStateRow[]> {
    return readPrStatesIn({ tx: this.tx, keys })
  }

  async upsertPrSubscriptionLease(params: PrSubscriptionLease & { expiresAt: string }) {
    await upsertPrSubscriptionLeaseIn({ tx: this.tx, ...params })
  }

  async deletePrSubscriptionLease(params: PrSubscriptionLease): Promise<boolean> {
    return deletePrSubscriptionLeaseIn({ tx: this.tx, ...params })
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
