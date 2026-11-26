import type { Hash, InboxEntry, JsonValue, Lease, ModelChoice, ThreadId } from '@dltech/atlas-core'
import type { SessionModelAsk } from '@dltech/atlas-models'
import type { EChangeFileStatus, SessionChange } from '@dltech/atlas-protocol'

import type { ContextFileRow, ContextFileWrite } from './context-files'
import type {
  AdvanceRoutineParams,
  InsertRoutineRunParams,
  ListDueRoutinesParams,
  ListRoutineRunsParams,
  ListRoutinesParams,
  ReadRoutineForUserParams,
  RoutineRow,
  RoutineRunRow,
} from './routine-rows'
import type {
  ControlSessionRow,
  PrChecks,
  SessionBucketCountParams,
  SessionBucketCounts,
  SessionDigestRow,
  SessionListParams,
  SessionModelRow,
} from './session-rows'
import type {
  ControlTerminalRow,
  CreateTerminalParams,
  EndTerminalParams,
  TerminalEndedReason,
} from './terminal-rows'

export type PodPlacedSession = { sessionId: string; archivedAt: string | null }

export type {
  ControlTerminalRow,
  CreateTerminalParams,
  EndTerminalParams,
  TerminalEndedReason,
  TerminalState,
} from './terminal-rows'

export type {
  ControlDigestPullRequest,
  ControlDigestView,
  ControlSessionDigest,
  ControlSessionRow,
  PrChecks,
  SessionBucketCountParams,
  SessionBucketCounts,
  SessionDigestRow,
  SessionListParams,
  SessionModelRow,
  SessionPageCursor,
  SessionTurnEnding,
} from './session-rows'

export type {
  AdvanceRoutineParams,
  InsertRoutineRunParams,
  ListDueRoutinesParams,
  ListRoutineRunsParams,
  ListRoutinesParams,
  ReadRoutineForUserParams,
  RoutineRow,
  RoutineRunOutcome,
  RoutineRunRow,
} from './routine-rows'

export type ClaimedBatch = { leases: Lease[]; nextRetryAt: string | null }

export type SessionViewRow = {
  sessionId: string
  threadId: string
  atSeq: number
  version: number
  state: string
}

export type SessionBranchRow = {
  sessionId: string
  headRepo: string
  branch: string
  firstSeenSeq: number
  firstSeenAt: string | null
}

export type SessionPullRequestRow = {
  sessionId: string
  repo: string
  number: number
}

export type PrHead = { headRepo: string; branch: string }

export type PrRef = { repo: string; number: number }

export type PrStateRow = {
  repo: string
  number: number
  title: string
  state: string
  headSha: string
  checksRunning: number
  checksPassed: number
  checksFailed: number
  checksExpected: number
  mergeQueued: boolean
  autoMerge: boolean
  mergeable: boolean | null
  updatedAt: string
  closedAt?: string | null | undefined
  mergedAt?: string | null | undefined
  headRepoFullName?: string | null | undefined
  headBranch?: string | undefined
}

export type TrackedPullRequestState = {
  title: string
  state: string
  headSha: string
  checks: PrChecks
  mergeable: boolean | null
  mergeQueued: boolean
  autoMerge: boolean
  updatedAt: string
}

export type TrackedPullRequestRow = {
  sessionId: string
  repo: string
  number: number
  url: string
  branch: string
  state: TrackedPullRequestState
}

export type TrackingTargetKind = 'head' | 'pull-request'

export type TrackingTarget = {
  userId: string
  kind: TrackingTargetKind
  repoFullName: string
  branch: string
  prNumber: number | null
  liveUntil: string | null
}

export type SubscriptionSubject =
  | { kind: 'pull-request'; number: number }
  | { kind: 'workflow-run'; selector: string }

export type SubscriptionLeaseKey = {
  userId: string
  threadId: string
  repo: string
  subject: SubscriptionSubject
}

export type SubscriptionLease = SubscriptionLeaseKey & {
  events: readonly string[]
}

export const subscriptionSubjectKey = (subject: SubscriptionSubject): string =>
  subject.kind === 'pull-request' ? `#${subject.number}` : subject.selector

export type SubscriptionKey = {
  userId: string
  repoFullName: string
  branch: string
  threadId: string
}

export type SubscriptionDraft = SubscriptionKey & {
  sessionId: string
  provider: string
  kind: string
  prNumber: number | null
  target: JsonValue | null
  label: string
  createdBy: string
  events: readonly string[]
  expiresAt: string | null
  deadline: string | null
  createdAt: string
}

export type SubscriptionRow = SubscriptionDraft & { subscriptionId: string }

export type WrittenSubscriptionRow = { row: SubscriptionRow; inserted: boolean }

export type ReleasePullRequestTrackingParams = {
  userId: string
  repoFullName: string
  prNumber: number
  at: string
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

export type ChangeBlobWrite = { hash: string; size: number }

export type ChangeBlobRow = { hash: string; size: number; createdAt: number }

export type ChangedFileWrite = {
  path: string
  oldPath: string | null
  status: EChangeFileStatus
  additions: number
  deletions: number
  binary: boolean
  baseHash: string | null
  currentHash: string | null
  size: number | null
}

export type WorktreeChangesWrite = {
  checkoutId: string
  sessionId: string
  repo: string
  worktreePath: string
  base: string | null
  fingerprint: string
  updatedAt: number
  files: readonly ChangedFileWrite[]
}

export type WorktreeChangesSummary = Omit<WorktreeChangesWrite, 'files'>

export type WorktreeChangesRead = WorktreeChangesSummary & {
  files: readonly ChangedFileWrite[]
}

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

export type AppendOpening = {
  row: ThreadRow
  lease: Lease | undefined
  mainThreadId: string
  view: SessionViewRow | undefined
}

export type AppendCommit = {
  events: readonly StoredEvent[]
  head: {
    threadId: string
    expectedHeadSeq: number
    headSeq: number
    headHash: Hash
    visibility: string
  }
  view?: SessionViewRow | undefined
  change: SessionChange
}

export type EffectReceiptKey = { threadId: string; stepKey: string }

export type EffectReceiptClaim = { kind: 'claimed' } | { kind: 'replayed'; result: JsonValue }

export class SeqConflictError extends Error {
  constructor() {
    super('thread sequence conflict')
    this.name = 'SeqConflictError'
  }
}

export interface ControlTx {
  now(): Promise<string>
  useSnapshot(): Promise<void>
  resolveSessionModel(params: {
    userId: string
    projectId: string | null
    ask: SessionModelAsk
    current?: ModelChoice | undefined
  }): Promise<SessionModelRow>
  createSession(params: {
    sessionId: string
    userId: string
    projectId: string | null
    title?: string | undefined
    mainThreadId: string
    modelRef: string
    modelEffort: string
    modelFast: boolean
    sandboxProvider: string
    credentialSource: string
    sandboxInstanceId: string | null
    spawnedBySessionId?: string | undefined
    nested?: boolean | undefined
    podSessionId?: string | undefined
    routineId?: string | undefined
    at: string
  }): Promise<void>
  setSessionModel(params: { sessionId: string } & SessionModelRow): Promise<boolean>
  setSandboxInstanceId(params: {
    sessionId: string
    sandboxInstanceId: string | null
  }): Promise<boolean>
  setSandboxStatus(params: {
    sandboxInstanceId: string
    status: string
    reason?: string | undefined
    at: string
  }): Promise<boolean>
  parkPod(params: { sessionId: string; at: string }): Promise<{ parkedAt: string }>
  failPodPark(params: { sessionId: string; parkedAt: string; error: string }): Promise<boolean>
  clearPodPark(params: { sessionId: string }): Promise<boolean>
  readSession(params: { sessionId: string }): Promise<ControlSessionRow | undefined>
  readNestedChildren(params: { sessionId: string }): Promise<ControlSessionRow[]>
  lockSession(sessionId: string): Promise<ControlSessionRow | undefined>
  setSessionPodDesired(params: {
    sessionId: string
    vcpus: number
    memoryGb: number
    diskGb?: number | undefined
    generation: number
  }): Promise<boolean>
  setSessionPodApplied(params: {
    sessionId: string
    vcpus: number
    memoryGb: number
    generation: number
  }): Promise<boolean>
  setSessionPodDisk(params: { sessionId: string; diskGb: number }): Promise<boolean>
  setSessionPodFailed(params: {
    sessionId: string
    generation: number
    error: string
  }): Promise<boolean>
  setSessionPodWaiting(params: {
    sessionId: string
    generation: number
    since: string | null
  }): Promise<boolean>
  takeSessionPodWait(params: {
    sessionId: string
    generation: number
    since: string
  }): Promise<boolean>
  setSessionPodWaitCancelled(params: {
    sessionId: string
    generation: number
    vcpus: number | null
    memoryGb: number | null
  }): Promise<boolean>
  setSessionArchived(params: { sessionId: string; archivedAt: string | null }): Promise<boolean>
  setSessionReadSeq(params: { sessionId: string; seq: number }): Promise<number | undefined>
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
  countSessionBuckets(params: SessionBucketCountParams): Promise<SessionBucketCounts>
  podPeersPlaced(params: { podSessionId: string; excludeSessionId: string }): Promise<number>
  podSessionsPlaced(params: { podSessionId: string }): Promise<PodPlacedSession[]>
  createThread(params: {
    threadId: string
    sessionId: string
    visibility: string
    at: string
  }): Promise<void>
  openAppend(threadId: string): Promise<AppendOpening | undefined>
  commitAppend(params: AppendCommit): Promise<boolean>
  lockThread(threadId: string): Promise<ThreadRow | undefined>
  readThread(threadId: string): Promise<ThreadRow | undefined>
  readThreads(threadIds: readonly string[]): Promise<ThreadRow[]>
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
  changeBlobsPresent(hashes: readonly string[]): Promise<ReadonlySet<string>>
  upsertChanges(params: {
    sessionId: string
    write: WorktreeChangesWrite
    blobs: readonly ChangeBlobWrite[]
  }): Promise<void>
  readChanges(params: { sessionId: string }): Promise<WorktreeChangesRead[]>
  readChangesSummary(params: { sessionId: string }): Promise<WorktreeChangesSummary[]>
  readChangeFile(params: {
    sessionId: string
    checkoutId: string
    path: string
  }): Promise<ChangedFileWrite | undefined>
  changesUpdatedAt(params: { sessionId: string }): Promise<number | null>
  changeBlobsUnreferenced(params: {
    olderThanMs: number
    limit: number
  }): Promise<readonly ChangeBlobRow[]>
  deleteChangeBlobs(params: { hashes: readonly string[] }): Promise<void>
  upsertContextFiles(params: {
    sessionId: string
    files: readonly ContextFileWrite[]
  }): Promise<void>
  removeContextFiles(params: { sessionId: string; paths: readonly string[] }): Promise<void>
  listContextFiles(params: { sessionId: string }): Promise<readonly ContextFileRow[]>
  contextFileOf(params: { sessionId: string; path: string }): Promise<ContextFileRow | null>
  contextDigestsReferenced(params: { digests: readonly string[] }): Promise<ReadonlySet<string>>
  lockContextDigest(params: { digest: string }): Promise<void>
  readLease(sessionId: string): Promise<Lease | undefined>
  readLeases(sessionIds: readonly string[]): Promise<Lease[]>
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
    forThread: ThreadId | null
  }): Promise<InboxEntry[]>
  recentInboxEntries(params: {
    sessionId: string
    limit: number
    forThread: ThreadId | null
  }): Promise<InboxEntry[]>
  firstUnconsumedMessages(params: { sessionIds: readonly string[] }): Promise<InboxEntry[]>
  notifyWake(sessionId: string): Promise<void>
  announce(change: SessionChange): Promise<void>
  readSessionView(sessionId: string): Promise<SessionViewRow | undefined>
  readSessionViews(sessionIds: readonly string[]): Promise<SessionViewRow[]>
  writeSessionView(row: SessionViewRow): Promise<void>
  insertSessionBranches(rows: readonly SessionBranchRow[]): Promise<void>
  insertSessionPullRequests(rows: readonly SessionPullRequestRow[]): Promise<void>
  sessionsTrackingHead(head: PrHead): Promise<string[]>
  sessionsTrackingPullRequest(pullRequest: PrRef): Promise<string[]>
  readTrackedPullRequests(sessionIds: readonly string[]): Promise<TrackedPullRequestRow[]>
  upsertSubscriptionLease(params: SubscriptionLease & { expiresAt: string }): Promise<void>
  deleteSubscriptionLease(params: SubscriptionLeaseKey): Promise<boolean>
  lockSubscriptionKey(key: SubscriptionKey): Promise<void>
  findSubscription(key: SubscriptionKey): Promise<SubscriptionRow | undefined>
  readSubscription(subscriptionId: string): Promise<SubscriptionRow | undefined>
  readSessionSubscriptionRows(sessionId: string): Promise<SubscriptionRow[]>
  insertSubscriptionRow(row: SubscriptionDraft): Promise<WrittenSubscriptionRow>
  updateSubscriptionRow(params: {
    subscriptionId: string
    provider: string
    target: JsonValue
    label: string
    events: readonly string[]
    expiresAt: string | null
    deadline: string | null
  }): Promise<boolean>
  deleteSubscriptionRow(subscriptionId: string): Promise<boolean>
  deleteSubscriptionRowIfEndedBefore(params: {
    subscriptionId: string
    at: string
  }): Promise<boolean>
  upsertTrackingTarget(params: TrackingTarget): Promise<void>
  releasePullRequestTracking(params: ReleasePullRequestTrackingParams): Promise<void>
  hostPresent(hostId: number): Promise<boolean>
  hostsPresent(hostIds: readonly number[]): Promise<ReadonlySet<number>>
  lockRoutine(routineId: string): Promise<RoutineRow | undefined>
  readRoutine(routineId: string): Promise<RoutineRow | undefined>
  advanceRoutine(params: AdvanceRoutineParams): Promise<boolean>
  insertRoutineRun(params: InsertRoutineRunParams): Promise<void>
  insertRoutine(row: RoutineRow): Promise<void>
  updateRoutine(row: RoutineRow): Promise<void>
  deleteRoutine(routineId: string): Promise<void>
  claimEffectReceipt(params: EffectReceiptKey): Promise<EffectReceiptClaim>
  readEffectReceipt(params: EffectReceiptKey): Promise<JsonValue | undefined>
  completeEffectReceipt(params: EffectReceiptKey & { result: JsonValue }): Promise<void>
}

export abstract class ControlStorePort {
  abstract transact<T>(work: (tx: ControlTx) => Promise<T>): Promise<T>
  abstract listTerminals(params: { sessionId: string }): Promise<ControlTerminalRow[]>
  abstract readTerminal(params: {
    sessionId: string
    terminalId: string
  }): Promise<ControlTerminalRow | undefined>
  abstract createTerminal(params: CreateTerminalParams): Promise<ControlTerminalRow | undefined>
  abstract renameTerminal(params: {
    sessionId: string
    terminalId: string
    name: string
  }): Promise<ControlTerminalRow | undefined>
  abstract markTerminalOpen(params: { sessionId: string; terminalId: string }): Promise<void>
  abstract endTerminal(params: EndTerminalParams): Promise<ControlTerminalRow | undefined>
  abstract endTerminals(params: { sessionId: string; reason: TerminalEndedReason }): Promise<number>
  abstract deleteTerminal(params: { sessionId: string; terminalId: string }): Promise<void>
  abstract listDueRoutines(params: ListDueRoutinesParams): Promise<RoutineRow[]>
  abstract listRoutines(params: ListRoutinesParams): Promise<RoutineRow[]>
  abstract readRoutineForUser(params: ReadRoutineForUserParams): Promise<RoutineRow | undefined>
  abstract listRoutineRuns(params: ListRoutineRunsParams): Promise<RoutineRunRow[]>
}
