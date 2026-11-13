import type { Hash, InboxEntry, Lease, SessionStatus } from '@dltech/atlas-core'
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
  modelRef: string | null
  modelEffort: string | null
  modelFast: boolean | null
  spawnedBySessionId: string | null
  nested: boolean
  podSessionId: string | null
  routineId: string | null
}

export type SessionListParams = {
  userId: string
  projectId?: string | undefined
  sessionId?: string | undefined
  spawnedBySessionId?: string | undefined
  limit: number
}

export type SessionDigestRow = ControlSessionRow & {
  lastEventAt: string | null
  firstMessageText: string | null
  firstMessageAt: string | null
}

export type PrChecks = { running: number; passed: number; failed: number }

export type ControlDigestPullRequest = {
  repo: string
  number: number
  url: string
  state: string | null
  checks: PrChecks | null
}

export type ControlDigestView = {
  status: SessionStatus
  primaryBranch: string | null
  pullRequest: ControlDigestPullRequest | null
}

export type ControlSessionDigest = SessionDigestRow & { view: ControlDigestView | null }

export type SessionViewRow = {
  sessionId: string
  threadId: string
  atSeq: number
  version: number
  state: string
}

export type SessionPullRequestKey = { repo: string; number: number }

export type SessionPullRequestRow = SessionPullRequestKey & { sessionId: string }

export type PrStateRow = SessionPullRequestKey & {
  title: string
  state: string
  headSha: string
  checksRunning: number
  checksPassed: number
  checksFailed: number
  mergeable: boolean | null
  updatedAt: string
}

export type SubscriptionSubject =
  | { kind: 'pull-request'; number: number }
  | { kind: 'workflow-run'; selector: string }

export type SubscriptionLease = {
  userId: string
  threadId: string
  repo: string
  subject: SubscriptionSubject
}

export const subscriptionSubjectKey = (subject: SubscriptionSubject): string =>
  subject.kind === 'pull-request' ? `#${subject.number}` : subject.selector

export type RoutineRow = {
  routineId: string
  userId: string
  projectId: string
  name: string
  prompt: string
  cron: string
  timezone: string
  enabled: boolean
  modelRef: string | null
  modelEffort: string | null
  modelFast: boolean | null
  nextRunAt: string
  lastRunAt: string | null
  lastSessionId: string | null
  createdAt: string
  updatedAt: string
}

export type RoutineRunOutcome = 'started' | 'skipped-busy' | 'skipped' | 'failed'

export type AdvanceRoutineParams = {
  routineId: string
  expectedNextRunAt: string
  nextRunAt: string
  lastRunAt?: string | undefined
  lastSessionId?: string | undefined
  at: string
}

export type InsertRoutineRunParams = {
  id: string
  routineId: string
  scheduledFor: string
  outcome: RoutineRunOutcome
  reason?: string | undefined
  sessionId?: string | undefined
  at: string
}

export type ListDueRoutinesParams = { now: string; limit: number }

export type RoutineRunRow = {
  id: string
  routineId: string
  scheduledFor: string
  outcome: RoutineRunOutcome
  reason: string | null
  sessionId: string | null
  at: string
}

export type ListRoutinesParams = { userId: string; projectId?: string | undefined }

export type ReadRoutineForUserParams = { routineId: string; userId: string }

export type ListRoutineRunsParams = { routineId: string; limit: number }

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
    modelRef?: string | undefined
    modelEffort?: string | undefined
    modelFast?: boolean | undefined
    spawnedBySessionId?: string | undefined
    nested?: boolean | undefined
    podSessionId?: string | undefined
    routineId?: string | undefined
    at: string
  }): Promise<void>
  readSession(params: { sessionId: string }): Promise<ControlSessionRow | undefined>
  lockSession(sessionId: string): Promise<ControlSessionRow | undefined>
  setSessionArchived(params: { sessionId: string; archivedAt: string | null }): Promise<boolean>
  setSessionTitleIfUntitled(params: {
    sessionId: string
    title: string
    fromInboxId: number | null
  }): Promise<boolean>
  setSessionTitle(params: { sessionId: string; title: string }): Promise<boolean>
  clearTitleFrom(params: { sessionId: string; inboxId: number }): Promise<boolean>
  listSessions(params: {
    userId: string
    projectId?: string | undefined
    limit: number
  }): Promise<ControlSessionRow[]>
  listSessionDigests(params: SessionListParams): Promise<SessionDigestRow[]>
  podPeersPlaced(params: { podSessionId: string; excludeSessionId: string }): Promise<number>
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
  readSessionView(sessionId: string): Promise<SessionViewRow | undefined>
  writeSessionView(row: SessionViewRow): Promise<void>
  insertSessionPullRequests(rows: readonly SessionPullRequestRow[]): Promise<void>
  sessionsLinkedTo(key: SessionPullRequestKey): Promise<string[]>
  readPrStates(keys: readonly SessionPullRequestKey[]): Promise<PrStateRow[]>
  upsertSubscriptionLease(params: SubscriptionLease & { expiresAt: string }): Promise<void>
  deleteSubscriptionLease(params: SubscriptionLease): Promise<boolean>
  hostPresent(hostId: number): Promise<boolean>
  lockRoutine(routineId: string): Promise<RoutineRow | undefined>
  readRoutine(routineId: string): Promise<RoutineRow | undefined>
  advanceRoutine(params: AdvanceRoutineParams): Promise<boolean>
  insertRoutineRun(params: InsertRoutineRunParams): Promise<void>
  insertRoutine(row: RoutineRow): Promise<void>
  updateRoutine(row: RoutineRow): Promise<void>
  deleteRoutine(routineId: string): Promise<void>
}

export abstract class ControlStorePort {
  abstract transact<T>(work: (tx: ControlTx) => Promise<T>): Promise<T>
  abstract listDueRoutines(params: ListDueRoutinesParams): Promise<RoutineRow[]>
  abstract listRoutines(params: ListRoutinesParams): Promise<RoutineRow[]>
  abstract readRoutineForUser(params: ReadRoutineForUserParams): Promise<RoutineRow | undefined>
  abstract listRoutineRuns(params: ListRoutineRunsParams): Promise<RoutineRunRow[]>
}
