import type { InboxEntry, Lease } from '@dltech/atlas-core'
import type { SessionChange } from '@dltech/atlas-protocol'

import {
  type AdvanceRoutineParams,
  type BlobRefWrite,
  type BlobRow,
  type BlobWrite,
  type ClaimedBatch,
  type ControlTx,
  type SubscriptionLease,
  type ReadEventsParams,
  type StoredEvent,
  type ThreadRow,
  type ControlSessionRow,
  type SessionDigestRow,
  type InsertRoutineRunParams,
  type RoutineRow,
  type SessionListParams,
} from '../../port'
import {
  allocateInboxIdIn,
  deleteInboxEntryIn,
  insertInboxEntryIn,
  markInboxConsumedIn,
  readInboxEntriesIn,
  readInboxEntryIn,
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
import { subscriptionLeaseKey } from './memory-state'
import { blobHashesPresent, insertBlobRows, readBlobRow } from './memory-blobs'
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
  setSessionArchivedIn,
  setSessionTitleIfUntitledIn,
  setSessionTitleIn,
} from './memory-sessions'
import { refKey, type State } from './memory-state'
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

  async createSession(params: {
    sessionId: string
    userId: string
    projectId: string
    title?: string | undefined
    mainThreadId: string
    modelRef?: string | undefined
    modelEffort?: string | undefined
    modelFast?: boolean | undefined
    spawnedBySessionId?: string | undefined
    nested?: boolean | undefined
    podSessionId?: string | undefined
    at: string
  }): Promise<void> {
    createSessionIn({ state: this.state, ...params })
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
