import { retryOnConnectionLoss, type Db, type Tx } from '@dltech/atlas-db'
import { GENESIS_HASH, type InboxEntry, type Lease } from '@dltech/atlas-core'
import type { SessionChange } from '@dltech/atlas-protocol'

import {
  ControlStorePort,
  type AdvanceRoutineParams,
  type BlobRefWrite,
  type BlobRow,
  type BlobWrite,
  type ChangeBlobRow,
  type ChangeBlobWrite,
  type ChangedFileWrite,
  type ClaimedBatch,
  type ControlTx,
  type InsertRoutineRunParams,
  type ListDueRoutinesParams,
  type ListRoutineRunsParams,
  type ListRoutinesParams,
  type ReadRoutineForUserParams,
  type RoutineRow,
  type RoutineRunRow,
  type ReadEventsParams,
  type StoredEvent,
  type ThreadRow,
  type ControlSessionRow,
  type SubscriptionLease,
  type TrackingTarget,
  type SessionDigestRow,
  type SessionListParams,
  type PrHead,
  type PrRef,
  type ControlTerminalRow,
  type CreateTerminalParams,
  type EndTerminalParams,
  type TerminalEndedReason,
  type SessionBranchRow,
  type SessionPullRequestRow,
  type SessionViewRow,
  type TrackedPullRequestRow,
  type WorktreeChangesRead,
  type WorktreeChangesWrite,
} from '../port'
import {
  changeBlobHashesPresentIn,
  changeBlobsUnreferencedIn,
  changesUpdatedAtIn,
  deleteChangeBlobRowsIn,
  readChangeFileIn,
  readChangesIn,
  upsertChangesIn,
} from './postgres-changes'
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
import { resolveSessionModelIn } from './postgres-session-model'
import { sessionDigestsIn } from './postgres-digests'
import { podPeersPlacedIn } from './postgres-peers'
import {
  clearTitleFromIn,
  createSessionIn,
  readSessionIn,
  setSandboxInstanceIdIn,
  setSandboxStatusIn,
  setSessionArchivedIn,
  setSessionModelIn,
  setSessionReadSeqIn,
  setSessionPodAppliedIn,
  setSessionPodDesiredIn,
  setSessionPodFailedIn,
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
  recentInboxEntriesIn,
  readInboxEntryIn,
} from './postgres-inbox'
import {
  insertSessionBranchesIn,
  insertSessionPullRequestsIn,
  readSessionViewIn,
  readTrackedPullRequestsIn,
  sessionsTrackingHeadIn,
  sessionsTrackingPullRequestIn,
  writeSessionViewIn,
} from './postgres-views'
import {
  advanceRoutineIn,
  deleteRoutineIn,
  dueRoutinesIn,
  insertRoutineIn,
  insertRoutineRunIn,
  lockRoutineIn,
  readRoutineIn,
  routineRunsIn,
  updateRoutineIn,
  userRoutineIn,
  userRoutinesIn,
} from './postgres-routines'
import { deleteSubscriptionLeaseIn, upsertSubscriptionLeaseIn } from './postgres-subscriptions'
import { upsertTrackingTargetIn } from './postgres-tracking-targets'
import { toLease, toThreadRow } from './postgres-rows'
import { insertEventsIn, listSessionsIn, readEventsIn, writeThreadHeadIn } from './postgres-threads'
import {
  createTerminalIn,
  deleteTerminalIn,
  endSessionTerminalsIn,
  endTerminalIn,
  listTerminalsIn,
  markTerminalOpenIn,
  readTerminalIn,
  renameTerminalIn,
} from './postgres-terminals'

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

  async resolveSessionModel(params: Parameters<ControlTx['resolveSessionModel']>[0]) {
    return resolveSessionModelIn({ tx: this.tx, ...params })
  }

  async createSession(params: Parameters<ControlTx['createSession']>[0]): Promise<void> {
    await createSessionIn({ tx: this.tx, ...params })
  }

  async setSessionModel(params: Parameters<ControlTx['setSessionModel']>[0]) {
    return setSessionModelIn({ tx: this.tx, ...params })
  }

  async setSandboxInstanceId(params: Parameters<ControlTx['setSandboxInstanceId']>[0]) {
    return setSandboxInstanceIdIn({ tx: this.tx, ...params })
  }

  async setSandboxStatus(params: Parameters<ControlTx['setSandboxStatus']>[0]) {
    return setSandboxStatusIn({ tx: this.tx, ...params })
  }

  async readSession(params: { sessionId: string }): Promise<ControlSessionRow | undefined> {
    return readSessionIn({ tx: this.tx, sessionId: params.sessionId, lock: false })
  }

  async lockSession(sessionId: string): Promise<ControlSessionRow | undefined> {
    return readSessionIn({ tx: this.tx, sessionId, lock: true })
  }

  async setSessionPodDesired(params: Parameters<ControlTx['setSessionPodDesired']>[0]) {
    return setSessionPodDesiredIn({ tx: this.tx, ...params })
  }

  async setSessionPodApplied(params: Parameters<ControlTx['setSessionPodApplied']>[0]) {
    return setSessionPodAppliedIn({ tx: this.tx, ...params })
  }

  async setSessionPodFailed(params: Parameters<ControlTx['setSessionPodFailed']>[0]) {
    return setSessionPodFailedIn({ tx: this.tx, ...params })
  }

  async setSessionArchived(params: { sessionId: string; archivedAt: string | null }) {
    return setSessionArchivedIn({ tx: this.tx, ...params })
  }

  async setSessionReadSeq(params: { sessionId: string; seq: number }) {
    return setSessionReadSeqIn({ tx: this.tx, ...params })
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

  async changeBlobsPresent(hashes: readonly string[]): Promise<ReadonlySet<string>> {
    return changeBlobHashesPresentIn(this.tx, hashes)
  }

  async upsertChanges(params: {
    sessionId: string
    write: WorktreeChangesWrite
    blobs: readonly ChangeBlobWrite[]
  }): Promise<void> {
    await upsertChangesIn({ tx: this.tx, ...params })
  }

  async readChanges(params: { sessionId: string }): Promise<WorktreeChangesRead[]> {
    return readChangesIn({ tx: this.tx, ...params })
  }

  async readChangeFile(params: {
    sessionId: string
    checkoutId: string
    path: string
  }): Promise<ChangedFileWrite | undefined> {
    return readChangeFileIn({ tx: this.tx, ...params })
  }

  async changesUpdatedAt(params: { sessionId: string }): Promise<number | null> {
    return changesUpdatedAtIn({ tx: this.tx, ...params })
  }

  async changeBlobsUnreferenced(params: {
    olderThanMs: number
    limit: number
  }): Promise<readonly ChangeBlobRow[]> {
    return changeBlobsUnreferencedIn({ tx: this.tx, ...params })
  }

  async deleteChangeBlobs(params: { hashes: readonly string[] }): Promise<void> {
    await deleteChangeBlobRowsIn({ tx: this.tx, ...params })
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

  async recentInboxEntries(params: { sessionId: string; limit: number }) {
    return recentInboxEntriesIn({ tx: this.tx, ...params })
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

  async insertSessionBranches(rows: readonly SessionBranchRow[]): Promise<void> {
    await insertSessionBranchesIn({ tx: this.tx, rows })
  }

  async insertSessionPullRequests(rows: readonly SessionPullRequestRow[]): Promise<void> {
    await insertSessionPullRequestsIn({ tx: this.tx, rows })
  }

  async sessionsTrackingHead(head: PrHead): Promise<string[]> {
    return sessionsTrackingHeadIn({ tx: this.tx, ...head })
  }

  async sessionsTrackingPullRequest(pullRequest: PrRef): Promise<string[]> {
    return sessionsTrackingPullRequestIn({ tx: this.tx, ...pullRequest })
  }

  async readTrackedPullRequests(sessionIds: readonly string[]): Promise<TrackedPullRequestRow[]> {
    return readTrackedPullRequestsIn({ tx: this.tx, sessionIds })
  }

  async upsertSubscriptionLease(params: SubscriptionLease & { expiresAt: string }) {
    await upsertSubscriptionLeaseIn({ tx: this.tx, ...params })
  }

  async deleteSubscriptionLease(params: SubscriptionLease): Promise<boolean> {
    return deleteSubscriptionLeaseIn({ tx: this.tx, ...params })
  }

  async upsertTrackingTarget(params: TrackingTarget): Promise<void> {
    await upsertTrackingTargetIn({ tx: this.tx, ...params })
  }

  async hostPresent(hostId: number): Promise<boolean> {
    return hostPresentIn({ tx: this.tx, hostId })
  }

  async lockRoutine(routineId: string): Promise<RoutineRow | undefined> {
    return lockRoutineIn({ tx: this.tx, routineId })
  }

  async readRoutine(routineId: string): Promise<RoutineRow | undefined> {
    return readRoutineIn({ tx: this.tx, routineId })
  }

  async advanceRoutine(params: AdvanceRoutineParams): Promise<boolean> {
    return advanceRoutineIn({ tx: this.tx, ...params })
  }

  async insertRoutineRun(params: InsertRoutineRunParams): Promise<void> {
    await insertRoutineRunIn({ tx: this.tx, ...params })
  }

  async insertRoutine(row: RoutineRow): Promise<void> {
    await insertRoutineIn({ tx: this.tx, row })
  }

  async updateRoutine(row: RoutineRow): Promise<void> {
    await updateRoutineIn({ tx: this.tx, row })
  }

  async deleteRoutine(routineId: string): Promise<void> {
    await deleteRoutineIn({ tx: this.tx, routineId })
  }
}

export class PostgresControlStore extends ControlStorePort {
  constructor(private readonly db: Db) {
    super()
  }

  transact<T>(work: (tx: ControlTx) => Promise<T>): Promise<T> {
    return retryOnConnectionLoss(() => this.db.transaction((tx) => work(new PostgresTx(tx))))
  }

  listDueRoutines(params: ListDueRoutinesParams): Promise<RoutineRow[]> {
    return retryOnConnectionLoss(() =>
      this.db.transaction((tx) => dueRoutinesIn({ tx, ...params })),
    )
  }

  listRoutines(params: ListRoutinesParams): Promise<RoutineRow[]> {
    return retryOnConnectionLoss(() =>
      this.db.transaction((tx) => userRoutinesIn({ tx, ...params })),
    )
  }

  readRoutineForUser(params: ReadRoutineForUserParams): Promise<RoutineRow | undefined> {
    return retryOnConnectionLoss(() =>
      this.db.transaction((tx) => userRoutineIn({ tx, ...params })),
    )
  }

  listRoutineRuns(params: ListRoutineRunsParams): Promise<RoutineRunRow[]> {
    return retryOnConnectionLoss(() =>
      this.db.transaction((tx) => routineRunsIn({ tx, ...params })),
    )
  }

  listTerminals(params: { sessionId: string }): Promise<ControlTerminalRow[]> {
    return retryOnConnectionLoss(() =>
      this.db.transaction((tx) => listTerminalsIn({ tx, ...params })),
    )
  }

  readTerminal(params: {
    sessionId: string
    terminalId: string
  }): Promise<ControlTerminalRow | undefined> {
    return retryOnConnectionLoss(() =>
      this.db.transaction((tx) => readTerminalIn({ tx, ...params })),
    )
  }

  createTerminal(params: CreateTerminalParams): Promise<ControlTerminalRow | undefined> {
    return retryOnConnectionLoss(() =>
      this.db.transaction((tx) => createTerminalIn({ tx, ...params })),
    )
  }

  renameTerminal(params: {
    sessionId: string
    terminalId: string
    name: string
  }): Promise<ControlTerminalRow | undefined> {
    return retryOnConnectionLoss(() =>
      this.db.transaction((tx) => renameTerminalIn({ tx, ...params })),
    )
  }

  markTerminalOpen(params: { sessionId: string; terminalId: string }): Promise<void> {
    return retryOnConnectionLoss(() =>
      this.db.transaction(async (tx) => {
        await markTerminalOpenIn({ tx, ...params })
      }),
    )
  }

  endTerminal(params: EndTerminalParams): Promise<ControlTerminalRow | undefined> {
    return retryOnConnectionLoss(() =>
      this.db.transaction((tx) => endTerminalIn({ tx, ...params })),
    )
  }

  endTerminals(params: { sessionId: string; reason: TerminalEndedReason }): Promise<number> {
    return retryOnConnectionLoss(() =>
      this.db.transaction((tx) => endSessionTerminalsIn({ tx, ...params })),
    )
  }

  deleteTerminal(params: { sessionId: string; terminalId: string }): Promise<void> {
    return retryOnConnectionLoss(() =>
      this.db.transaction(async (tx) => {
        await deleteTerminalIn({ tx, ...params })
      }),
    )
  }
}
