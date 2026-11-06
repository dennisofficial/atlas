import { GENESIS_HASH, type InboxEntry, type Lease } from '@dltech/atlas-core'
import type { SessionChange } from '@dltech/atlas-protocol'

import type { ChangeFeed } from '../../change-feed'
import {
  ControlStorePort,
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
} from '../../port'
import { MemoryChangeFeed } from './memory-change-feed'
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
import { leasesHeldByIn } from './memory-leases'
import { sessionDigestsIn } from './memory-digests'
import { sessionsNeedingHolderIn } from './memory-needing-holder'
import { cloneState, emptyState, refKey, type State } from './memory-state'

class MemoryTx implements ControlTx {
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
    if (this.state.sessions.has(params.sessionId)) throw new Error('session exists')
    this.state.sessions.set(params.sessionId, {
      sessionId: params.sessionId,
      userId: params.userId,
      projectId: params.projectId,
      title: params.title ?? null,
      mainThreadId: params.mainThreadId,
      createdAt: params.at,
      archivedAt: null,
      nextInboxId: 1,
    })
  }

  async readSession(params: { sessionId: string }): Promise<ControlSessionRow | undefined> {
    const row = this.state.sessions.get(params.sessionId)
    if (row === undefined) return undefined
    const { nextInboxId: _nextInboxId, ...session } = row
    return { ...session }
  }

  async setSessionArchived(params: {
    sessionId: string
    archivedAt: string | null
  }): Promise<boolean> {
    const row = this.state.sessions.get(params.sessionId)
    if (row === undefined) return false
    row.archivedAt = params.archivedAt
    return true
  }

  async listSessions(params: {
    userId: string
    projectId?: string | undefined
    limit: number
  }): Promise<ControlSessionRow[]> {
    return [...this.state.sessions.values()]
      .filter((row) => row.userId === params.userId)
      .filter((row) => params.projectId === undefined || row.projectId === params.projectId)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, params.limit)
      .map(({ nextInboxId: _nextInboxId, ...session }) => ({ ...session }))
  }

  async listSessionDigests(params: SessionListParams): Promise<ControlSessionDigest[]> {
    return sessionDigestsIn({ state: this.state, ...params })
  }

  async sessionsNeedingHolder(params: { limit: number }): Promise<string[]> {
    return sessionsNeedingHolderIn({
      state: this.state,
      presentHosts: this.presentHosts,
      ...params,
    })
  }

  async createThread(params: {
    threadId: string
    sessionId: string
    visibility: string
  }): Promise<void> {
    if (this.state.threads.has(params.threadId)) throw new Error('thread exists')
    if (!this.state.sessions.has(params.sessionId)) throw new Error('unknown session')
    this.state.threads.set(params.threadId, {
      threadId: params.threadId,
      sessionId: params.sessionId,
      headSeq: 0,
      headHash: GENESIS_HASH,
      visibility: params.visibility,
    })
    this.state.events.set(params.threadId, [])
  }

  async useSnapshot(): Promise<void> {}

  async lockThread(threadId: string): Promise<ThreadRow | undefined> {
    return this.readThread(threadId)
  }

  async readThread(threadId: string): Promise<ThreadRow | undefined> {
    const row = this.state.threads.get(threadId)
    return row === undefined ? undefined : { ...row }
  }

  async writeThreadHead(params: {
    threadId: string
    expectedHeadSeq: number
    headSeq: number
    headHash: ThreadRow['headHash']
    visibility: string
  }): Promise<boolean> {
    const row = this.state.threads.get(params.threadId)
    if (row === undefined || row.headSeq !== params.expectedHeadSeq) return false
    row.headSeq = params.headSeq
    row.headHash = params.headHash
    row.visibility = params.visibility
    return true
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
    const current = this.state.leases.get(params.lease.sessionId)
    if (!this.state.sessions.has(params.lease.sessionId)) return false
    const epoch = current?.epoch ?? 0
    if (epoch !== params.expectedEpoch) return false
    if (current === undefined && params.expectedEpoch !== 0) return false
    this.state.leases.set(params.lease.sessionId, { ...params.lease })
    return true
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

  async hostPresent(hostId: number): Promise<boolean> {
    return this.presentHosts.has(hostId)
  }
}

export class InMemoryControlStore extends ControlStorePort implements ChangeFeed {
  private readonly clock: () => string
  private state: State = emptyState()
  private tail: Promise<unknown> = Promise.resolve()
  private readonly presentHosts = new Set<number>()
  private lastHostId = 0
  private readonly feed = new MemoryChangeFeed()

  constructor(params: { clock?: (() => string) | undefined } = {}) {
    super()
    this.clock = params.clock ?? (() => new Date().toISOString())
  }

  transact<T>(work: (tx: ControlTx) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const working = cloneState(this.state)
      const pending: SessionChange[] = []
      const result = await work(
        new MemoryTx({
          state: working,
          clock: this.clock,
          presentHosts: this.presentHosts,
          pending,
        }),
      )
      this.state = working
      this.feed.publish(pending)
      return result
    }
    const next = this.tail.then(run, run)
    this.tail = next.catch(() => undefined)
    return next
  }

  nextHostId(): number {
    this.lastHostId += 1
    return this.lastHostId
  }

  markHostPresent(hostId: number): void {
    this.presentHosts.add(hostId)
  }

  markHostAbsent(hostId: number): void {
    this.presentHosts.delete(hostId)
  }

  wakeCount(sessionId: string): number {
    return this.state.notifications.filter((id) => id === sessionId).length
  }

  onChange(listener: (change: SessionChange) => void): () => void {
    return this.feed.onChange(listener)
  }

  onGap(listener: () => void): () => void {
    return this.feed.onGap(listener)
  }

  changesOf(sessionId: string): SessionChange[] {
    return this.feed.changesOf(sessionId)
  }
}
