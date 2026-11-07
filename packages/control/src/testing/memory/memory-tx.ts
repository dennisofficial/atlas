import type { InboxEntry, Lease } from '@dltech/atlas-core'
import type { SessionChange } from '@dltech/atlas-protocol'

import type { ChangeFeed } from '../../change-feed'
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
  type SessionDigestRow,
  type SessionListParams,
  type SessionPullRequestKey,
  type SessionPullRequestRow,
  type SessionViewRow,
} from '../../port'
import {
  allocateInboxIdIn,
  deleteInboxEntryIn,
  insertInboxEntryIn,
  markInboxConsumedIn,
  readInboxEntriesIn,
  readInboxEntryIn,
} from './memory-inbox'
import { blobHashesPresent, insertBlobRows, readBlobRow } from './memory-blobs'
import { insertEventsIn, readEventsIn } from './memory-events'
import { claimNeedingIn } from './memory-claim-next'
import { leasesHeldByIn, writeLeaseIn } from './memory-leases'
import { createThreadIn, readThreadIn, writeThreadHeadIn } from './memory-threads'
import { sessionDigestsIn } from './memory-digests'
import {
  clearTitleFromIn,
  createSessionIn,
  listSessionsIn,
  readSessionIn,
  setSessionArchivedIn,
  setSessionTitleIfUntitledIn,
} from './memory-sessions'
import { MemoryTestControls } from './memory-test-controls'
import { cloneState, emptyState, refKey, type State } from './memory-state'
import {
  insertSessionPullRequestsIn,
  readPrStatesIn,
  readSessionViewIn,
  sessionsLinkedToIn,
  writeSessionViewIn,
} from './memory-views'

export class MemoryTx implements ControlTx {
  private readonly state: State
  private readonly clock: () => string
  private readonly presentHosts: ReadonlySet<number>
  private readonly pending: SessionChange[]

  constructor(params: {
    state: State
    clock: () => string
    presentHosts: ReadonlySet<number>
    pending: SessionChange[]
  }) {
    this.state = params.state
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
    at: string
  }): Promise<void> {
    createSessionIn({ state: this.state, ...params })
  }

  async readSession(params: { sessionId: string }): Promise<ControlSessionRow | undefined> {
    return readSessionIn({ state: this.state, ...params })
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

  async readSessionView(sessionId: string): Promise<SessionViewRow | undefined> {
    return readSessionViewIn({ state: this.state, sessionId })
  }

  async writeSessionView(row: SessionViewRow): Promise<void> {
    writeSessionViewIn({ state: this.state, row })
  }

  async insertSessionPullRequests(rows: readonly SessionPullRequestRow[]): Promise<void> {
    insertSessionPullRequestsIn({ state: this.state, rows })
  }

  async sessionsLinkedTo(key: SessionPullRequestKey): Promise<string[]> {
    return sessionsLinkedToIn({ state: this.state, key })
  }

  async readPrStates(keys: readonly SessionPullRequestKey[]): Promise<PrStateRow[]> {
    return readPrStatesIn({ state: this.state, keys })
  }

  async hostPresent(hostId: number): Promise<boolean> {
    return this.presentHosts.has(hostId)
  }
}
