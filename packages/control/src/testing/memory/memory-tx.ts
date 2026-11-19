import type { InboxEntry, Lease } from '@dltech/atlas-core'
import type { SessionChange } from '@dltech/atlas-protocol'

import {
  type AdvanceRoutineParams,
  type BlobRefWrite,
  type BlobRow,
  type BlobWrite,
  type ChangeBlobRow,
  type ChangeBlobWrite,
  type ChangedFileWrite,
  type ClaimedBatch,
  type ControlTx,
  type SubscriptionLease,
  type TrackingTarget,
  type ReadEventsParams,
  type StoredEvent,
  type ThreadRow,
  type ControlSessionRow,
  type SessionDigestRow,
  type InsertRoutineRunParams,
  type RoutineRow,
  type SessionListParams,
  type WorktreeChangesRead,
  type WorktreeChangesWrite,
} from '../../port'
import {
  allocateInboxIdIn,
  deleteInboxEntryIn,
  insertInboxEntryIn,
  markInboxConsumedIn,
  readInboxEntriesIn,
  readInboxEntryIn,
  recentInboxEntriesIn,
} from './memory-inbox'
import {
  advanceRoutineIn,
  deleteRoutineIn,
  insertRoutineIn,
  insertRoutineRunIn,
  lockRoutineIn,
  readRoutineIn,
  updateRoutineIn,
} from './memory-routines'
import { subscriptionLeaseKey, trackingTargetKey } from './memory-state'
import { blobHashesPresent, insertBlobRows, readBlobRow } from './memory-blobs'
import {
  changeBlobsUnreferencedIn,
  changesUpdatedAtIn,
  deleteChangeBlobRowsIn,
  readChangeFileIn,
  readChangesIn,
  upsertChangesIn,
} from './memory-changes'
import { insertEventsIn, readEventsIn } from './memory-events'
import { claimNeedingIn } from './memory-claim-next'
import { leasesHeldByIn, writeLeaseIn } from './memory-leases'
import { createThreadIn, readThreadIn, writeThreadHeadIn } from './memory-threads'
import { sessionDigestsIn } from './memory-digests'
import { podPeersPlacedIn } from './memory-peers'
import {
  clearTitleFromIn,
  createSessionIn,
  listSessionsIn,
  readSessionIn,
  setSandboxInstanceIdIn,
  setSandboxStatusIn,
  setSessionArchivedIn,
  setSessionReadSeqIn,
  setSessionTitleIfUntitledIn,
  setSessionTitleIn,
} from './memory-sessions'
import { refKey, type State } from './memory-state'
import { resolveSessionModelIn, setSessionModelIn } from './memory-session-model'
import { MemoryTxViews } from './memory-tx-views'

export class MemoryTx extends MemoryTxViews implements ControlTx {
  private readonly clock: () => string
  private readonly presentHosts: ReadonlySet<number>
  private readonly pending: SessionChange[]

  constructor(params: {
    state: State
    clock: () => string
    presentHosts: ReadonlySet<number>
    pending: SessionChange[]
  }) {
    super(params.state)
    this.clock = params.clock
    this.presentHosts = params.presentHosts
    this.pending = params.pending
  }

  async now(): Promise<string> {
    return this.clock()
  }

  async resolveSessionModel(params: Parameters<ControlTx['resolveSessionModel']>[0]) {
    return resolveSessionModelIn(params)
  }

  async createSession(params: Parameters<ControlTx['createSession']>[0]): Promise<void> {
    createSessionIn({ state: this.state, ...params })
  }

  async setSessionModel(params: Parameters<ControlTx['setSessionModel']>[0]) {
    const row = this.state.sessions.get(params.sessionId)
    if (row === undefined) return false
    setSessionModelIn({ row, model: params })
    return true
  }

  async setSandboxInstanceId(params: Parameters<ControlTx['setSandboxInstanceId']>[0]) {
    return setSandboxInstanceIdIn({ state: this.state, ...params })
  }

  async setSandboxStatus(params: Parameters<ControlTx['setSandboxStatus']>[0]) {
    return setSandboxStatusIn({ state: this.state, ...params })
  }

  async readSession(params: { sessionId: string }): Promise<ControlSessionRow | undefined> {
    return readSessionIn({ state: this.state, ...params })
  }

  async podPeersPlaced(params: {
    podSessionId: string
    excludeSessionId: string
  }): Promise<number> {
    return podPeersPlacedIn({ state: this.state, ...params })
  }

  async setSessionArchived(params: { sessionId: string; archivedAt: string | null }) {
    return setSessionArchivedIn({ state: this.state, ...params })
  }

  async setSessionReadSeq(params: { sessionId: string; seq: number }) {
    return setSessionReadSeqIn({ state: this.state, ...params })
  }

  async lockSession(sessionId: string): Promise<ControlSessionRow | undefined> {
    return readSessionIn({ state: this.state, sessionId })
  }

  async setSessionTitleIfUntitled(params: Parameters<ControlTx['setSessionTitleIfUntitled']>[0]) {
    return setSessionTitleIfUntitledIn({ state: this.state, ...params })
  }

  async setSessionTitle(params: { sessionId: string; title: string }) {
    return setSessionTitleIn({ state: this.state, ...params })
  }

  async clearTitleFrom(params: { sessionId: string; inboxId: number }) {
    return clearTitleFromIn({ state: this.state, ...params })
  }

  async listSessions(params: {
    userId: string
    projectId?: string | undefined
    limit: number
  }): Promise<ControlSessionRow[]> {
    return listSessionsIn({ state: this.state, ...params })
  }

  async listSessionDigests(params: SessionListParams): Promise<SessionDigestRow[]> {
    return sessionDigestsIn({ state: this.state, ...params })
  }

  async createThread(params: {
    threadId: string
    sessionId: string
    visibility: string
  }): Promise<void> {
    createThreadIn({ state: this.state, ...params })
  }

  async useSnapshot(): Promise<void> {}

  async lockThread(threadId: string): Promise<ThreadRow | undefined> {
    return this.readThread(threadId)
  }

  async readThread(threadId: string): Promise<ThreadRow | undefined> {
    return readThreadIn({ state: this.state, threadId })
  }

  async writeThreadHead(params: {
    threadId: string
    expectedHeadSeq: number
    headSeq: number
    headHash: ThreadRow['headHash']
    visibility: string
  }): Promise<boolean> {
    return writeThreadHeadIn({ state: this.state, ...params })
  }

  async insertEvents(rows: readonly StoredEvent[]): Promise<void> {
    insertEventsIn({ state: this.state, rows })
  }

  async insertBlobs(rows: readonly BlobWrite[]): Promise<void> {
    insertBlobRows(this.state.blobs, rows)
  }

  async insertBlobRefs(rows: readonly BlobRefWrite[]): Promise<void> {
    for (const row of rows) this.state.blobRefs.add(refKey(row))
  }

  async readBlob(params: { hash: string }): Promise<BlobRow | undefined> {
    return readBlobRow(this.state.blobs, params.hash)
  }

  async blobsExist(hashes: readonly string[]): Promise<ReadonlySet<string>> {
    return blobHashesPresent(this.state.blobs, hashes)
  }

  async blobReferencedBy(params: { sessionId: string; hash: string }): Promise<boolean> {
    return this.state.blobRefs.has(refKey(params))
  }

  async changeBlobsPresent(hashes: readonly string[]): Promise<ReadonlySet<string>> {
    return new Set(hashes.filter((hash) => this.state.changeBlobs.has(hash)))
  }

  async upsertChanges(params: {
    sessionId: string
    write: WorktreeChangesWrite
    blobs: readonly ChangeBlobWrite[]
  }): Promise<void> {
    upsertChangesIn({
      state: this.state,
      write: params.write,
      blobs: params.blobs,
      at: Date.parse(this.clock()),
    })
    this.pending.push({ sessionId: params.sessionId })
  }

  async readChanges(params: { sessionId: string }): Promise<WorktreeChangesRead[]> {
    return readChangesIn({ state: this.state, ...params })
  }

  async readChangeFile(params: {
    sessionId: string
    checkoutId: string
    path: string
  }): Promise<ChangedFileWrite | undefined> {
    return readChangeFileIn({ state: this.state, ...params })
  }

  async changesUpdatedAt(params: { sessionId: string }): Promise<number | null> {
    return changesUpdatedAtIn({ state: this.state, ...params })
  }

  async changeBlobsUnreferenced(params: {
    olderThanMs: number
    limit: number
  }): Promise<readonly ChangeBlobRow[]> {
    return changeBlobsUnreferencedIn({
      state: this.state,
      now: Date.parse(this.clock()),
      ...params,
    })
  }

  async deleteChangeBlobs(params: { hashes: readonly string[] }): Promise<void> {
    deleteChangeBlobRowsIn({ state: this.state, ...params })
  }

  async readEvents(params: ReadEventsParams): Promise<StoredEvent[]> {
    return readEventsIn({ state: this.state, ...params })
  }

  async readLease(sessionId: string): Promise<Lease | undefined> {
    const lease = this.state.leases.get(sessionId)
    return lease === undefined ? undefined : { ...lease }
  }

  async leasesHeldBy(params: { hostId: number; limit: number }): Promise<Lease[]> {
    return leasesHeldByIn({ state: this.state, ...params })
  }

  async lockLease(sessionId: string): Promise<Lease | undefined> {
    return this.readLease(sessionId)
  }

  async shareLease(sessionId: string): Promise<Lease | undefined> {
    return this.readLease(sessionId)
  }

  async writeLease(params: { lease: Lease; expectedEpoch: number }): Promise<boolean> {
    return writeLeaseIn({ state: this.state, ...params })
  }

  async claimNeeding(params: {
    hostId: number
    now: string
    limit: number
  }): Promise<ClaimedBatch> {
    return claimNeedingIn({ state: this.state, presentHosts: this.presentHosts, ...params })
  }

  async allocateInboxId(sessionId: string): Promise<number> {
    return allocateInboxIdIn({ state: this.state, sessionId })
  }

  async insertInboxEntry(entry: InboxEntry): Promise<void> {
    insertInboxEntryIn({ state: this.state, entry })
  }

  async readInboxEntry(params: { sessionId: string; inboxId: number }) {
    return readInboxEntryIn({ state: this.state, ...params })
  }

  async markInboxConsumed(params: {
    sessionId: string
    inboxId: number
    seq: number
  }): Promise<boolean> {
    return markInboxConsumedIn({ state: this.state, ...params })
  }

  async deleteInboxEntry(params: { sessionId: string; inboxId: number }): Promise<boolean> {
    return deleteInboxEntryIn({ state: this.state, ...params })
  }

  async readInboxEntries(params: {
    sessionId: string
    afterId: number
    limit: number
    excludeKind?: string | undefined
  }) {
    return readInboxEntriesIn({ state: this.state, ...params })
  }

  async recentInboxEntries(params: { sessionId: string; limit: number }) {
    return recentInboxEntriesIn({ state: this.state, ...params })
  }

  async notifyWake(sessionId: string): Promise<void> {
    this.state.notifications.push(sessionId)
  }

  async announce(change: SessionChange): Promise<void> {
    this.pending.push({ ...change })
  }

  async upsertSubscriptionLease(params: SubscriptionLease & { expiresAt: string }) {
    this.state.subscriptionLeases.set(subscriptionLeaseKey(params), { ...params })
  }

  async deleteSubscriptionLease(params: SubscriptionLease): Promise<boolean> {
    return this.state.subscriptionLeases.delete(subscriptionLeaseKey(params))
  }

  async upsertTrackingTarget(params: TrackingTarget): Promise<void> {
    const key = trackingTargetKey(params)
    const held = this.state.trackingTargets.get(key)
    const liveUntil =
      held !== undefined && Date.parse(held.liveUntil) > Date.parse(params.liveUntil)
        ? held.liveUntil
        : params.liveUntil
    this.state.trackingTargets.set(key, { ...params, liveUntil })
  }

  async hostPresent(hostId: number): Promise<boolean> {
    return this.presentHosts.has(hostId)
  }

  async lockRoutine(routineId: string): Promise<RoutineRow | undefined> {
    return lockRoutineIn({ state: this.state, routineId })
  }

  async readRoutine(routineId: string): Promise<RoutineRow | undefined> {
    return readRoutineIn({ state: this.state, routineId })
  }

  async advanceRoutine(params: AdvanceRoutineParams): Promise<boolean> {
    return advanceRoutineIn({ state: this.state, ...params })
  }

  async insertRoutineRun(params: InsertRoutineRunParams): Promise<void> {
    await insertRoutineRunIn({ state: this.state, ...params })
  }

  async insertRoutine(row: RoutineRow): Promise<void> {
    await insertRoutineIn({ state: this.state, row })
  }

  async updateRoutine(row: RoutineRow): Promise<void> {
    await updateRoutineIn({ state: this.state, row })
  }

  async deleteRoutine(routineId: string): Promise<void> {
    await deleteRoutineIn({ state: this.state, routineId })
  }
}
