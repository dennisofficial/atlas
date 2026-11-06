import type { Hash, InboxEntry, Lease } from '@dltech/atlas-core'
import type { SessionChange } from '@dltech/atlas-protocol'

export type ClaimedBatch = { leases: Lease[]; nextRetryAt: string | null }

export type ControlSessionRow = {
  sessionId: string
  userId: string
  projectId: string
  title: string | null
  mainThreadId: string
  createdAt: string
  archivedAt: string | null
}

export type SessionListParams = {
  userId: string
  projectId?: string | undefined
  sessionId?: string | undefined
  limit: number
}

export type ControlSessionDigest = ControlSessionRow & {
  lastEventAt: string | null
  firstMessageText: string | null
  firstMessageAt: string | null
}

export type ThreadRow = {
  threadId: string
  sessionId: string
  headSeq: number
  headHash: Hash
  visibility: string
}

export type BlobWrite = { hash: string; bytes: Uint8Array }

export type BlobRow = { size: number; bytes: Uint8Array }

export type BlobRefWrite = { sessionId: string; hash: string }

export type StoredEvent = {
  threadId: string
  seq: number
  id: string
  epoch: number
  type: string
  runId: string
  at: string
  prevHash: Hash
  hash: Hash
  canonical: string
}

export type ReadEventsParams = {
  threadId: string
  afterSeq: number
  throughSeq: number
  limit: number
  onlyTypes?: readonly string[] | undefined
}

export class SeqConflictError extends Error {
  constructor() {
    super('thread sequence conflict')
    this.name = 'SeqConflictError'
  }
}

export interface ControlTx {
  now(): Promise<string>
  useSnapshot(): Promise<void>
  createSession(params: {
    sessionId: string
    userId: string
    projectId: string
    title?: string | undefined
    mainThreadId: string
    at: string
  }): Promise<void>
  readSession(params: { sessionId: string }): Promise<ControlSessionRow | undefined>
  setSessionArchived(params: { sessionId: string; archivedAt: string | null }): Promise<boolean>
  setSessionTitleIfUntitled(params: { sessionId: string; title: string }): Promise<boolean>
  listSessions(params: {
    userId: string
    projectId?: string | undefined
    limit: number
  }): Promise<ControlSessionRow[]>
  listSessionDigests(params: SessionListParams): Promise<ControlSessionDigest[]>
  createThread(params: {
    threadId: string
    sessionId: string
    visibility: string
    at: string
  }): Promise<void>
  lockThread(threadId: string): Promise<ThreadRow | undefined>
  readThread(threadId: string): Promise<ThreadRow | undefined>
  writeThreadHead(params: {
    threadId: string
    expectedHeadSeq: number
    headSeq: number
    headHash: Hash
    visibility: string
  }): Promise<boolean>
  insertEvents(rows: readonly StoredEvent[]): Promise<void>
  insertBlobs(rows: readonly BlobWrite[]): Promise<void>
  insertBlobRefs(rows: readonly BlobRefWrite[]): Promise<void>
  readBlob(params: { hash: string }): Promise<BlobRow | undefined>
  blobsExist(hashes: readonly string[]): Promise<ReadonlySet<string>>
  blobReferencedBy(params: { sessionId: string; hash: string }): Promise<boolean>
  readEvents(params: ReadEventsParams): Promise<StoredEvent[]>
  readLease(sessionId: string): Promise<Lease | undefined>
  leasesHeldBy(params: { hostId: number; limit: number }): Promise<Lease[]>
  lockLease(sessionId: string): Promise<Lease | undefined>
  shareLease(sessionId: string): Promise<Lease | undefined>
  writeLease(params: { lease: Lease; expectedEpoch: number }): Promise<boolean>
  claimNeeding(params: { hostId: number; now: string; limit: number }): Promise<ClaimedBatch>
  allocateInboxId(sessionId: string): Promise<number>
  insertInboxEntry(entry: InboxEntry): Promise<void>
  readInboxEntry(params: { sessionId: string; inboxId: number }): Promise<InboxEntry | undefined>
  markInboxConsumed(params: { sessionId: string; inboxId: number; seq: number }): Promise<boolean>
  deleteInboxEntry(params: { sessionId: string; inboxId: number }): Promise<boolean>
  readInboxEntries(params: {
    sessionId: string
    afterId: number
    limit: number
    excludeKind?: string | undefined
  }): Promise<InboxEntry[]>
  notifyWake(sessionId: string): Promise<void>
  announce(change: SessionChange): Promise<void>
  hostPresent(hostId: number): Promise<boolean>
}

export abstract class ControlStorePort {
  abstract transact<T>(work: (tx: ControlTx) => Promise<T>): Promise<T>
}
