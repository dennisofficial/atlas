import {
  type ESubscriptionActor,
  type ESubscriptionEnd,
  type InboxEntry,
  type JsonValue,
  type Lease,
  type LeaseWriteResult,
  type LogHead,
  type PluginViewFold,
  type RevokeResult,
  type SpawnFile,
  type SubscriptionTargetState,
  type SubscriptionTargetStates,
  UNKNOWN_TARGET_STATE,
  type RecordEvent,
  type RecordEventType,
  type ThreadId,
} from '@dltech/atlas-core'
import type { SessionModelAsk } from '@dltech/atlas-models'
import type { SessionSubscription } from '@dltech/atlas-protocol'
import type { z } from 'zod'
import type { AppendHook } from './append-hooks'
import { appendIn } from './append-ops'
import { onceInReceipt } from './effect-receipts'
import type { ViewChangeHook } from './view-hooks'
import { readBlobIn } from './blob-ops'
import { UnknownThreadError } from './errors'
import { postIn, withdrawIn } from './inbox-ops'
import { messagePeerIn, reportToSpawnerIn, sessionsOfIn, spawnPeerIn } from './peer-sessions'
import { LeaseOps } from './lease-ops'
import type { ContextContentStore } from './context-content'
import type { ContextFileRow, ContextFileWrite } from './context-files'
import {
  ControlStorePort,
  SeqConflictError,
  type BlobRow,
  type ClaimedBatch,
  type BlobWrite,
  type ChangeBlobRow,
  type ChangeBlobWrite,
  type ChangedFileWrite,
  type ControlTx,
  type EffectReceiptKey,
  type ThreadRow,
  type WorktreeChangesRead,
  type WorktreeChangesSummary,
  type WorktreeChangesWrite,
  type ControlSessionDigest,
  type ControlSessionRow,
  type ListRoutineRunsParams,
  type ListRoutinesParams,
  type RoutineRow,
  type RoutineRunRow,
  type SessionBucketCountParams,
  type SessionBucketCounts,
  type SessionListParams,
  type SessionModelRow,
  type ControlTerminalRow,
  type CreateTerminalParams,
  type EndTerminalParams,
  type TerminalEndedReason,
} from './port'
import { claimNextIn, wakeIn } from './claim-ops'
import { markDigestPhase, withDigestViews, type DigestTimings } from './session-digest-view'
import {
  readSessionBusyWithCatchUp,
  readSessionViewWithCatchUp,
  type SessionBusyRead,
  type SessionViewRead,
} from './session-view-read'
import { readEventsIn, type ReadEventsPage } from './read-events'
import { readTailBaseIn, TAIL_BASE_ATTEMPTS, type TailBase } from './tail-base'
import { runRoutineIn, type RunRoutineParams, type RunRoutineResult } from './routine-ops'
import {
  removalReceiptOf,
  replayedMaybeRoutineOf,
  replayedRemovalOf,
  replayedRoutineOf,
  replayedSessionOf,
  storedMaybeRoutineOf,
  storedRoutineOf,
  storedSessionOf,
} from './routine-receipts'
import {
  createRoutineIn,
  deleteRoutineIn,
  updateRoutineIn,
  type RoutinePatch,
} from './routine-crud'
import { AppendAbort, type AppendOutcome } from './refusal'
import {
  archiveIn,
  cancelPodWaitIn,
  claimPodWaitIn,
  createSessionIn,
  markReadIn,
  recordPodAppliedIn,
  recordPodDesiredIn,
  recordPodDiskIn,
  recordPodFailedIn,
  recordPodWaitingIn,
  renameIn,
  setSessionModelIn,
  titleUntitledIn,
} from './session-ops'
import { archiveSpawnedOf, type SpawnedArchive } from './spawned-archive'
import { EMPTY_VISIBILITY_TEXT } from './stored-event'
import { endSubscriptionsIn, unsubscribeIn } from './subscription-endings'
import { listSubscriptionsIn } from './subscription-ops'
import { subscribeToStateIn, type SubscribeToStateResult } from './subscription-completion'
import type { SubscriptionLeaseInput } from './subscription-rows'

export const MAX_READ_LIMIT = 1000
export const MAX_SESSION_LIST_LIMIT = 100

export type ControlPlaneParams = {
  store: ControlStorePort
  clock?: (() => string) | undefined
  eventSchema?: z.ZodType<RecordEvent> | undefined
  pluginViews?: readonly PluginViewFold[] | undefined
  appendHooks?: readonly AppendHook[] | undefined
  viewHooks?: readonly ViewChangeHook[] | undefined
  targetStates?: SubscriptionTargetStates | undefined
}

export type { ReadEventsPage } from './read-events'

const clampLimit = (limit: number): number => Math.max(1, Math.min(limit, MAX_READ_LIMIT))
const clampSessionLimit = (limit: number): number =>
  Math.max(1, Math.min(limit, MAX_SESSION_LIST_LIMIT))
const headOf = (row: ThreadRow): LogHead => ({
  seq: row.headSeq,
  hash: row.headHash,
})

export class ControlPlane {
  private readonly store: ControlStorePort
  private readonly clock: (() => string) | undefined
  private readonly leases: LeaseOps
  private readonly eventSchema: z.ZodType<RecordEvent> | undefined
  private readonly pluginViews: readonly PluginViewFold[]
  private readonly appendHooks: readonly AppendHook[]
  private readonly viewHooks: readonly ViewChangeHook[]
  private readonly targetStates: SubscriptionTargetStates | undefined

  constructor(params: ControlPlaneParams) {
    this.targetStates = params.targetStates
    this.store = params.store
    this.clock = params.clock
    this.eventSchema = params.eventSchema
    this.pluginViews = params.pluginViews ?? []
    this.appendHooks = params.appendHooks ?? []
    this.viewHooks = params.viewHooks ?? []
    this.leases = new LeaseOps({ store: params.store })
  }

  private async nowIn(tx: ControlTx): Promise<string> {
    return this.clock?.() ?? (await tx.now())
  }

  async createSession(params: {
    sessionId: string
    userId: string
    projectId: string | null
    title?: string | undefined
    mainThreadId: string
    model?: SessionModelAsk | undefined
    sandboxProvider?: string | undefined
    sandboxInstanceId?: string | null | undefined
    routineId?: string | undefined
  }): Promise<SessionModelRow> {
    return this.store.transact(async (tx) =>
      createSessionIn({ tx, ...params, at: await this.nowIn(tx) }),
    )
  }

  async createSessionWithMessage(params: {
    sessionId: string
    userId: string
    projectId: string | null
    title?: string | undefined
    mainThreadId: string
    model?: SessionModelAsk | undefined
    sandboxProvider?: string | undefined
    sandboxInstanceId?: string | null | undefined
    routineId?: string | undefined
    message: { kind: string; payload: string }
    receipt?: EffectReceiptKey | undefined
  }): Promise<{ sessionId: string; inboxId: number } & SessionModelRow> {
    const { message, receipt, ...session } = params
    return this.store.transact(async (tx) =>
      onceInReceipt({
        tx,
        receipt,
        decode: replayedSessionOf,
        encode: storedSessionOf,
        run: async () => {
          const at = await this.nowIn(tx)
          const model = await createSessionIn({ tx, ...session, at })
          const { inboxId } = await postIn({
            tx,
            sessionId: params.sessionId,
            kind: message.kind,
            payload: message.payload,
            at,
          })
          return { sessionId: params.sessionId, inboxId, ...model }
        },
      }),
    )
  }

  async setSessionModel(params: {
    sessionId: string
    ask: SessionModelAsk
  }): Promise<SessionModelRow> {
    return this.store.transact((tx) => setSessionModelIn({ tx, ...params }))
  }

  async setSandboxInstanceId(params: {
    sessionId: string
    sandboxInstanceId: string | null
  }): Promise<boolean> {
    return this.store.transact((tx) => tx.setSandboxInstanceId(params))
  }

  async setSandboxStatus(params: {
    sandboxInstanceId: string
    status: string
    reason?: string | undefined
    at: string
  }): Promise<boolean> {
    return this.store.transact((tx) => tx.setSandboxStatus(params))
  }

  async parkPod(params: { sessionId: string }): Promise<{ parkedAt: string }> {
    return this.store.transact(async (tx) =>
      tx.parkPod({ sessionId: params.sessionId, at: await this.nowIn(tx) }),
    )
  }

  async failPodPark(params: {
    sessionId: string
    parkedAt: string
    error: string
  }): Promise<boolean> {
    return this.store.transact((tx) => tx.failPodPark(params))
  }

  async clearPodPark(params: { sessionId: string }): Promise<boolean> {
    return this.store.transact((tx) => tx.clearPodPark(params))
  }

  async recordPodDesired(params: {
    sessionId: string
    vcpus: number
    memoryGb: number
    diskGb?: number | undefined
  }): Promise<number> {
    return this.store.transact((tx) => recordPodDesiredIn({ tx, ...params }))
  }

  async recordPodApplied(params: {
    sessionId: string
    vcpus: number
    memoryGb: number
    generation: number
  }): Promise<boolean> {
    return this.store.transact((tx) => recordPodAppliedIn({ tx, ...params }))
  }

  async recordPodDisk(params: { sessionId: string; diskGb: number }): Promise<boolean> {
    return this.store.transact((tx) => recordPodDiskIn({ tx, ...params }))
  }

  async recordPodFailed(params: {
    sessionId: string
    generation: number
    error: string
  }): Promise<boolean> {
    return this.store.transact((tx) => recordPodFailedIn({ tx, ...params }))
  }

  async recordPodWaiting(params: {
    sessionId: string
    generation: number
    since: string
  }): Promise<boolean> {
    return this.store.transact((tx) => recordPodWaitingIn({ tx, ...params }))
  }

  async cancelPodWait(params: { sessionId: string }): Promise<boolean> {
    return this.store.transact((tx) => cancelPodWaitIn({ tx, ...params }))
  }

  async claimPodWait(params: {
    sessionId: string
    generation: number
    since: string
  }): Promise<boolean> {
    return this.store.transact((tx) => claimPodWaitIn({ tx, ...params }))
  }

  async spawnPeer(params: {
    spawnerSessionId: string
    sessionId: string
    mainThreadId: string
    modelRef?: string | undefined
    modelEffort?: string | undefined
    modelFast?: boolean | undefined
    title?: string | undefined
    brief?: string | undefined
    nested?: boolean | undefined
    files?: readonly SpawnFile[] | undefined
  }): Promise<{ inboxId: number | null; already: boolean } | { refused: string }> {
    return this.store.transact(async (tx) => {
      const spawner = await tx.readSession({
        sessionId: params.spawnerSessionId,
      })
      if (spawner === undefined) throw new Error(`unknown session ${params.spawnerSessionId}`)
      const { modelRef, modelEffort, modelFast, ...rest } = params
      return spawnPeerIn({
        tx,
        spawner,
        ...rest,
        model: { ref: modelRef, effort: modelEffort, fast: modelFast },
        at: await this.nowIn(tx),
      })
    })
  }

  async messagePeer(params: {
    fromSessionId: string
    toSessionId: string
    text: string
    clientId?: string | undefined
  }): Promise<{ inboxId: number; title: string | null } | { refused: string }> {
    return this.store.transact(async (tx) => {
      const from = await tx.readSession({ sessionId: params.fromSessionId })
      if (from === undefined) throw new Error(`unknown session ${params.fromSessionId}`)
      return messagePeerIn({ tx, from, ...params, at: await this.nowIn(tx) })
    })
  }

  async reportToSpawner(params: {
    sessionId: string
    text: string
    clientId?: string | undefined
  }): Promise<{ inboxId: number } | { refused: string }> {
    return this.store.transact(async (tx) => {
      const session = await tx.readSession({ sessionId: params.sessionId })
      if (session === undefined) throw new Error(`unknown session ${params.sessionId}`)
      return reportToSpawnerIn({
        tx,
        session,
        ...params,
        at: await this.nowIn(tx),
      })
    })
  }

  async sessionsOf(params: { sessionId: string }): Promise<{
    sessions: readonly ControlSessionDigest[]
  }> {
    return this.store.transact(async (tx) => {
      const session = await tx.readSession({ sessionId: params.sessionId })
      if (session === undefined) throw new Error(`unknown session ${params.sessionId}`)
      const { sessions } = await sessionsOfIn({ tx, session })
      return {
        sessions: await withDigestViews({
          tx,
          leases: this.leases,
          rows: sessions,
          now: await this.nowIn(tx),
          withView: true,
          eventSchema: this.eventSchema,
          pluginViews: this.pluginViews,
        }),
      }
    })
  }

  async podSessionsPlaced(params: { podSessionId: string }) {
    return this.store.transact((tx) => tx.podSessionsPlaced(params))
  }

  async podPeersPlaced(params: {
    podSessionId: string
    excludeSessionId: string
  }): Promise<number> {
    return this.store.transact((tx) => tx.podPeersPlaced(params))
  }

  async readSession(params: { sessionId: string }): Promise<ControlSessionRow | undefined> {
    return this.store.transact((tx) => tx.readSession(params))
  }

  async readThread(params: { threadId: string }): Promise<ThreadRow | undefined> {
    return this.store.transact((tx) => tx.readThread(params.threadId))
  }

  async setSessionArchived(params: { sessionId: string; archivedAt: string | null }) {
    await this.store.transact(async (tx) => archiveIn({ tx, ...params, at: await this.nowIn(tx) }))
  }

  async archiveSpawned(params: {
    fromSessionId: string
    sessionId: string
  }): Promise<SpawnedArchive> {
    return archiveSpawnedOf({
      store: this.store,
      leases: this.leases,
      nowIn: (tx) => this.nowIn(tx),
      ...params,
    })
  }

  async markSessionRead(params: { sessionId: string; seq: number }): Promise<number> {
    return this.store.transact((tx) => markReadIn({ tx, ...params }))
  }

  async titleUntitledSession(params: Omit<Parameters<typeof titleUntitledIn>[0], 'tx'>) {
    return this.store.transact((tx) => titleUntitledIn({ tx, ...params }))
  }

  async renameSession(params: Omit<Parameters<typeof renameIn>[0], 'tx'>) {
    await this.store.transact((tx) => renameIn({ tx, ...params }))
  }

  async listSessions(params: {
    userId: string
    projectId?: string | undefined
    limit: number
  }): Promise<ControlSessionRow[]> {
    return this.store.transact((tx) =>
      tx.listSessions({ ...params, limit: clampSessionLimit(params.limit) }),
    )
  }

  async listSessionDigests(
    params: SessionListParams & {
      withView?: boolean | undefined
      timings?: DigestTimings | undefined
    },
  ): Promise<ControlSessionDigest[]> {
    const { withView, timings, ...list } = params
    const calledAt = performance.now()
    return this.store.transact(async (tx) => {
      markDigestPhase(timings, 'transactionMs', calledAt)
      const rowsAt = performance.now()
      const rows = await tx.listSessionDigests({
        ...list,
        limit: clampSessionLimit(list.limit),
      })
      markDigestPhase(timings, 'digestRowsMs', rowsAt)
      return withDigestViews({
        tx,
        leases: this.leases,
        rows,
        now: await this.nowIn(tx),
        withView: withView === true,
        eventSchema: this.eventSchema,
        pluginViews: this.pluginViews,
        timings,
      })
    })
  }

  async countSessionBuckets(params: SessionBucketCountParams): Promise<SessionBucketCounts> {
    return this.store.transact((tx) => tx.countSessionBuckets(params))
  }

  async readSessionView(params: { sessionId: string; threadId: string }): Promise<SessionViewRead> {
    return readSessionViewWithCatchUp({
      store: this.store,
      leases: this.leases,
      nowIn: (tx) => this.nowIn(tx),
      ...params,
      eventSchema: this.eventSchema,
      pluginViews: this.pluginViews,
    })
  }

  async readSessionBusy(params: { sessionId: string; threadId: string }): Promise<SessionBusyRead> {
    return readSessionBusyWithCatchUp({
      store: this.store,
      leases: this.leases,
      nowIn: (tx) => this.nowIn(tx),
      ...params,
      eventSchema: this.eventSchema,
      pluginViews: this.pluginViews,
    })
  }

  async claimNext(params: { hostId: number; limit: number }): Promise<ClaimedBatch> {
    if (params.limit <= 0) return { leases: [], nextRetryAt: null }
    return this.store.transact(async (tx) =>
      claimNextIn({
        tx,
        hostId: params.hostId,
        limit: clampLimit(params.limit),
        now: await this.nowIn(tx),
      }),
    )
  }

  async leasesHeldBy(params: { hostId: number; limit: number }): Promise<Lease[]> {
    return this.store.transact((tx) =>
      tx.leasesHeldBy({
        hostId: params.hostId,
        limit: clampLimit(params.limit),
      }),
    )
  }

  async createThread(params: { threadId: string; sessionId: string }): Promise<void> {
    await this.store.transact(async (tx) => {
      const open = await tx.readThread(params.threadId)
      if (open !== undefined) {
        if (open.sessionId !== params.sessionId)
          throw new Error(`thread ${params.threadId} belongs to another session`)
        return
      }
      await tx.createThread({
        ...params,
        visibility: EMPTY_VISIBILITY_TEXT,
        at: await this.nowIn(tx),
      })
    })
  }

  async head(params: { threadId: string }): Promise<LogHead> {
    return this.store.transact(async (tx) => headOf(await this.requireThread({ tx, ...params })))
  }

  async append(params: {
    threadId: string
    epoch: number
    events: readonly unknown[]
    blobs?: readonly BlobWrite[] | undefined
  }): Promise<AppendOutcome> {
    try {
      return await this.store.transact((tx) =>
        appendIn({
          tx,
          eventSchema: this.eventSchema,
          pluginViews: this.pluginViews,
          appendHooks: this.appendHooks,
          viewHooks: this.viewHooks,
          nowIn: () => this.nowIn(tx),
          ...params,
        }),
      )
    } catch (error) {
      if (error instanceof AppendAbort) {
        return { ok: false, refusal: error.refusal, head: error.head }
      }
      if (!(error instanceof SeqConflictError)) throw error
      const head = await this.head({ threadId: params.threadId })
      return {
        ok: false,
        refusal: { kind: 'seq-mismatch', expected: head.seq + 1 },
        head,
      }
    }
  }

  async readEvents(params: {
    threadId: string
    afterSeq: number
    limit: number
    visible: boolean
    hiddenTypes?: readonly RecordEventType[] | undefined
    maxBytes?: number | undefined
  }): Promise<ReadEventsPage> {
    const limit = clampLimit(params.limit)
    return this.store.transact(async (tx) => {
      const row = await this.requireThread({ tx, threadId: params.threadId })
      return readEventsIn({
        tx,
        row,
        afterSeq: params.afterSeq,
        limit,
        visible: params.visible,
        hiddenTypes: params.hiddenTypes,
        maxBytes: params.maxBytes,
        eventSchema: this.eventSchema,
      })
    })
  }

  async readTailBase(params: {
    sessionId: string
    threadId: string
    tailFrom: number
  }): Promise<TailBase | undefined> {
    for (let attempt = 0; attempt < TAIL_BASE_ATTEMPTS; attempt += 1) {
      const base = await this.store.transact(async (tx) => {
        await this.requireThread({ tx, threadId: params.threadId })
        return readTailBaseIn({
          tx,
          ...params,
          eventSchema: this.eventSchema,
          pluginViews: this.pluginViews,
        })
      })
      if (base !== undefined) return base
    }
    return undefined
  }

  async readBlob(params: {
    hash: string
    offset?: number | undefined
    length?: number | undefined
  }): Promise<BlobRow | undefined> {
    return this.store.transact((tx) => readBlobIn({ tx, ...params }))
  }

  async blobReferencedBy(params: { sessionId: string; hash: string }): Promise<boolean> {
    return this.store.transact((tx) => tx.blobReferencedBy(params))
  }

  async changeBlobsPresent(params: { hashes: readonly string[] }): Promise<ReadonlySet<string>> {
    return this.store.transact((tx) => tx.changeBlobsPresent(params.hashes))
  }

  async upsertChanges(params: {
    sessionId: string
    write: WorktreeChangesWrite
    blobs: readonly ChangeBlobWrite[]
  }): Promise<void> {
    await this.store.transact((tx) => tx.upsertChanges(params))
  }

  async listTerminals(params: { sessionId: string }): Promise<ControlTerminalRow[]> {
    return this.store.listTerminals(params)
  }

  async readTerminal(params: {
    sessionId: string
    terminalId: string
  }): Promise<ControlTerminalRow | undefined> {
    return this.store.readTerminal(params)
  }

  async createTerminal(params: CreateTerminalParams): Promise<ControlTerminalRow | undefined> {
    return this.store.createTerminal(params)
  }

  async renameTerminal(params: {
    sessionId: string
    terminalId: string
    name: string
  }): Promise<ControlTerminalRow | undefined> {
    return this.store.renameTerminal(params)
  }

  async markTerminalOpen(params: { sessionId: string; terminalId: string }): Promise<void> {
    await this.store.markTerminalOpen(params)
  }

  async endTerminal(params: EndTerminalParams): Promise<ControlTerminalRow | undefined> {
    return this.store.endTerminal(params)
  }

  async endTerminals(params: { sessionId: string; reason: TerminalEndedReason }): Promise<number> {
    return this.store.endTerminals(params)
  }

  async deleteTerminal(params: { sessionId: string; terminalId: string }): Promise<void> {
    await this.store.deleteTerminal(params)
  }

  async readChanges(params: { sessionId: string }): Promise<readonly WorktreeChangesRead[]> {
    return this.store.transact((tx) => tx.readChanges(params))
  }

  async readChangesSummary(params: {
    sessionId: string
  }): Promise<readonly WorktreeChangesSummary[]> {
    return this.store.transact((tx) => tx.readChangesSummary(params))
  }

  async readChangeFile(params: {
    sessionId: string
    checkoutId: string
    path: string
  }): Promise<ChangedFileWrite | undefined> {
    return this.store.transact((tx) => tx.readChangeFile(params))
  }

  async changesUpdatedAt(params: { sessionId: string }): Promise<number | null> {
    return this.store.transact((tx) => tx.changesUpdatedAt(params))
  }

  async changeBlobsUnreferenced(params: {
    olderThanMs: number
    limit: number
  }): Promise<readonly ChangeBlobRow[]> {
    return this.store.transact((tx) => tx.changeBlobsUnreferenced(params))
  }

  async deleteChangeBlobs(params: { hashes: readonly string[] }): Promise<void> {
    await this.store.transact((tx) => tx.deleteChangeBlobs(params))
  }

  async upsertContextFiles(params: {
    sessionId: string
    files: readonly ContextFileWrite[]
  }): Promise<void> {
    await this.store.transact((tx) => tx.upsertContextFiles(params))
  }

  async removeContextFiles(params: { sessionId: string; paths: readonly string[] }): Promise<void> {
    await this.store.transact((tx) => tx.removeContextFiles(params))
  }

  async listContextFiles(params: { sessionId: string }): Promise<readonly ContextFileRow[]> {
    return this.store.transact((tx) => tx.listContextFiles(params))
  }

  async contextFileOf(params: { sessionId: string; path: string }): Promise<ContextFileRow | null> {
    return this.store.transact((tx) => tx.contextFileOf(params))
  }

  async contextDigestsReferenced(params: {
    digests: readonly string[]
  }): Promise<ReadonlySet<string>> {
    return this.store.transact((tx) => tx.contextDigestsReferenced(params))
  }

  async commitContextFile(params: {
    sessionId: string
    write: ContextFileWrite
    content: Pick<ContextContentStore, 'exists'>
  }): Promise<boolean> {
    return this.store.transact(async (tx) => {
      const { digest } = params.write
      if (digest !== null) {
        await tx.lockContextDigest({ digest })
        if (!(await params.content.exists({ hash: digest }))) return false
      }
      await tx.upsertContextFiles({ sessionId: params.sessionId, files: [params.write] })
      return true
    })
  }

  async removeContextBytesIfUnreferenced(params: {
    digest: string
    content: Pick<ContextContentStore, 'removing'>
  }): Promise<boolean> {
    return this.store.transact(async (tx) => {
      await tx.lockContextDigest({ digest: params.digest })
      const referenced = await tx.contextDigestsReferenced({ digests: [params.digest] })
      if (referenced.has(params.digest)) return false
      await params.content.removing([params.digest])
      return true
    })
  }

  async subscribe(params: {
    sessionId: string
    threadId: string
    provider: string
    target: JsonValue
    label: string
    events?: readonly string[] | undefined
    lease: SubscriptionLeaseInput
    by: ESubscriptionActor
  }): Promise<SubscribeToStateResult> {
    const state = await this.targetStateOf(params)
    return this.store.transact(async (tx) => {
      const session = await this.requireSession({ tx, sessionId: params.sessionId })
      const thread = await this.requireThread({ tx, threadId: params.threadId })
      if (thread.sessionId !== params.sessionId) {
        throw new Error(`thread ${params.threadId} belongs to another session`)
      }
      return subscribeToStateIn({ tx, session, ...params, state, at: await this.nowIn(tx) })
    })
  }

  private async targetStateOf(params: {
    sessionId: string
    provider: string
    target: JsonValue
  }): Promise<SubscriptionTargetState> {
    if (this.targetStates === undefined) return UNKNOWN_TARGET_STATE
    const session = await this.store.transact((tx) =>
      this.requireSession({ tx, sessionId: params.sessionId }),
    )
    return this.targetStates.read({
      userId: session.userId,
      provider: params.provider,
      target: params.target,
    })
  }

  async unsubscribe(params: {
    sessionId: string
    subscriptionId: string
    by: ESubscriptionActor
    reason: ESubscriptionEnd
  }): Promise<{ ended: boolean }> {
    return this.store.transact(async (tx) => {
      const session = await this.requireSession({ tx, sessionId: params.sessionId })
      return unsubscribeIn({ tx, session, ...params, at: await this.nowIn(tx) })
    })
  }

  async endSubscriptions(params: {
    sessionId: string
    by: ESubscriptionActor
    reason: ESubscriptionEnd
  }): Promise<number> {
    return this.store.transact(async (tx) => {
      const rows = await tx.readSessionSubscriptionRows(params.sessionId)
      return endSubscriptionsIn({
        tx,
        rows: rows.map((row) => ({ subscriptionId: row.subscriptionId, threadId: row.threadId })),
        by: params.by,
        reason: params.reason,
        at: await this.nowIn(tx),
      })
    })
  }

  async listSubscriptions(params: {
    sessionId: string
    threadId?: string | undefined
  }): Promise<readonly SessionSubscription[]> {
    return this.store.transact((tx) => listSubscriptionsIn({ tx, ...params }))
  }

  async post(params: {
    sessionId: string
    kind: string
    payload: string
    threadId?: ThreadId | undefined
    receipt?: string | undefined
  }): Promise<{ inboxId: number }> {
    return this.store.transact(async (tx) => postIn({ tx, ...params, at: await this.nowIn(tx) }))
  }

  async withdraw(params: {
    sessionId: string
    inboxId: number
  }): Promise<{ requestInboxId: number }> {
    return this.store.transact(async (tx) =>
      withdrawIn({ tx, ...params, at: await this.nowIn(tx) }),
    )
  }

  async readInboxEntry(params: {
    sessionId: string
    inboxId: number
  }): Promise<InboxEntry | undefined> {
    return this.store.transact((tx) => tx.readInboxEntry(params))
  }

  async deleteInboxEntry(params: { sessionId: string; inboxId: number }): Promise<boolean> {
    return this.store.transact((tx) => tx.deleteInboxEntry(params))
  }

  async readInbox(params: {
    sessionId: string
    afterId: number
    limit: number
    forThread?: ThreadId | null
  }): Promise<InboxEntry[]> {
    return this.store.transact((tx) =>
      tx.readInboxEntries({
        ...params,
        forThread: params.forThread ?? null,
        limit: clampLimit(params.limit),
      }),
    )
  }

  async grant(params: { sessionId: string; hostId: number }): Promise<Lease> {
    return this.leases.grant(params)
  }

  revoke(params: {
    sessionId: string
    wantsHolder: boolean
    resetRetry?: boolean | undefined
  }): Promise<Lease>
  revoke(params: {
    sessionId: string
    wantsHolder: boolean
    epoch: number
    resetRetry?: boolean | undefined
  }): Promise<RevokeResult>
  async revoke(params: {
    sessionId: string
    wantsHolder: boolean
    epoch?: number | undefined
    resetRetry?: boolean | undefined
  }): Promise<Lease | RevokeResult> {
    if (params.epoch === undefined) return this.leases.revoke(params)
    return this.leases.revokeIfEpoch({
      sessionId: params.sessionId,
      wantsHolder: params.wantsHolder,
      epoch: params.epoch,
      resetRetry: params.resetRetry,
    })
  }

  async clearStartAttempts(params: {
    sessionId: string
    epoch: number
  }): Promise<LeaseWriteResult> {
    return this.leases.clearAttemptsIfEpoch(params)
  }

  async currentLease(params: { sessionId: string }): Promise<{ lease: Lease; live: boolean }> {
    return this.leases.currentLease(params)
  }

  async wake(params: { sessionIds: readonly string[] }): Promise<void> {
    await this.store.transact((tx) => wakeIn({ tx, sessionIds: params.sessionIds }))
  }

  async hostPresent(params: { hostId: number }): Promise<boolean> {
    return this.store.transact((tx) => tx.hostPresent(params.hostId))
  }

  async runRoutine(params: RunRoutineParams): Promise<RunRoutineResult> {
    return this.store.transact((tx) =>
      runRoutineIn({
        tx,
        leases: this.leases,
        ...params,
        eventSchema: this.eventSchema,
        pluginViews: this.pluginViews,
      }),
    )
  }

  async readEffectReceipt(receipt: EffectReceiptKey): Promise<JsonValue | undefined> {
    return this.store.transact(async (tx) => await tx.readEffectReceipt(receipt))
  }

  async createRoutine(row: RoutineRow, receipt?: EffectReceiptKey): Promise<RoutineRow> {
    return this.store.transact(async (tx) =>
      onceInReceipt({
        tx,
        receipt,
        decode: replayedRoutineOf,
        encode: storedRoutineOf,
        run: async () => await createRoutineIn({ tx, row }),
      }),
    )
  }

  async updateRoutine(params: {
    routineId: string
    userId: string
    patch: RoutinePatch
    nextRunAt?: string | undefined
    at: string
    receipt?: EffectReceiptKey | undefined
  }): Promise<RoutineRow | undefined> {
    const { receipt, ...write } = params
    return this.store.transact(async (tx) =>
      onceInReceipt({
        tx,
        receipt,
        decode: replayedMaybeRoutineOf,
        encode: storedMaybeRoutineOf,
        run: async () => await updateRoutineIn({ tx, ...write }),
      }),
    )
  }

  async deleteRoutine(params: {
    routineId: string
    userId: string
    projectId?: string | undefined
    receipt?: EffectReceiptKey | undefined
  }): Promise<boolean> {
    const { receipt, ...write } = params
    return this.store.transact(async (tx) =>
      onceInReceipt({
        tx,
        receipt,
        decode: replayedRemovalOf,
        encode: removalReceiptOf,
        run: async () => await deleteRoutineIn({ tx, ...write }),
      }),
    )
  }

  async listRoutines(params: ListRoutinesParams): Promise<RoutineRow[]> {
    return this.store.listRoutines(params)
  }

  async readRoutine(params: {
    routineId: string
    userId: string
  }): Promise<RoutineRow | undefined> {
    return this.store.readRoutineForUser(params)
  }

  async listRoutineRuns(params: ListRoutineRunsParams): Promise<RoutineRunRow[]> {
    return this.store.listRoutineRuns(params)
  }

  private async requireSession(params: {
    tx: ControlTx
    sessionId: string
  }): Promise<ControlSessionRow> {
    const row = await params.tx.readSession({ sessionId: params.sessionId })
    if (row === undefined) throw new Error(`unknown session ${params.sessionId}`)
    return row
  }

  private async requireThread(params: { tx: ControlTx; threadId: string }): Promise<ThreadRow> {
    const row = await params.tx.readThread(params.threadId)
    if (row === undefined) throw new UnknownThreadError(params.threadId)
    return row
  }
}
