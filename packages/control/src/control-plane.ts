import {
  type EReportKind,
  type InboxEntry,
  type Lease,
  type LogHead,
  type PluginViewFold,
  type RevokeResult,
  type V2Event,
  type V2EventType,
} from '@dltech/atlas-core'
import type { z } from 'zod'
import type { AppendHook } from './append-hooks'
import { appendIn } from './append-ops'
import { readBlobIn } from './blob-ops'
import { UnknownThreadError } from './errors'
import { postIn, takeBackIn, type TakeBackResult } from './inbox-ops'
import {
  messagePeerIn,
  messageTeammateIn,
  reportToSpawnerIn,
  sessionsOfIn,
  spawnPeerIn,
} from './peer-sessions'
import { LeaseOps } from './lease-ops'
import {
  ControlStorePort,
  SeqConflictError,
  type BlobRow,
  type ClaimedBatch,
  type BlobWrite,
  type ControlTx,
  type ThreadRow,
  type ControlSessionDigest,
  type ControlSessionRow,
  type ListRoutineRunsParams,
  type ListRoutinesParams,
  type RoutineRow,
  type RoutineRunRow,
  type SessionListParams,
} from './port'
import { claimNextIn, wakeIn } from './claim-ops'
import { withDigestViews } from './session-digest-view'
import { readSessionViewWithCatchUp, type SessionViewRead } from './session-view-read'
import { readEventsIn, type ReadEventsPage } from './read-events'
import { runRoutineIn, type RunRoutineParams, type RunRoutineResult } from './routine-ops'
import {
  createRoutineIn,
  deleteRoutineIn,
  updateRoutineIn,
  type RoutinePatch,
} from './routine-crud'
import { AppendAbort, type AppendOutcome } from './refusal'
import { archiveIn, createSessionIn, renameIn, titleUntitledIn } from './session-ops'
import { EMPTY_VISIBILITY_TEXT } from './stored-event'

export const MAX_READ_LIMIT = 1000
export const MAX_SESSION_LIST_LIMIT = 100

export type ControlPlaneParams = {
  store: ControlStorePort
  clock?: (() => string) | undefined
  eventSchema?: z.ZodType<V2Event> | undefined
  pluginViews?: readonly PluginViewFold[] | undefined
  appendHooks?: readonly AppendHook[] | undefined
}

export type { ReadEventsPage } from './read-events'
export type { TakeBackResult } from './inbox-ops'

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
  private readonly eventSchema: z.ZodType<V2Event> | undefined
  private readonly pluginViews: readonly PluginViewFold[]
  private readonly appendHooks: readonly AppendHook[]

  constructor(params: ControlPlaneParams) {
    this.store = params.store
    this.clock = params.clock
    this.eventSchema = params.eventSchema
    this.pluginViews = params.pluginViews ?? []
    this.appendHooks = params.appendHooks ?? []
    this.leases = new LeaseOps({ store: params.store })
  }

  private async nowIn(tx: ControlTx): Promise<string> {
    return this.clock?.() ?? (await tx.now())
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
    routineId?: string | undefined
  }): Promise<void> {
    await this.store.transact(async (tx) =>
      createSessionIn({ tx, ...params, at: await this.nowIn(tx) }),
    )
  }

  async createSessionWithMessage(params: {
    sessionId: string
    userId: string
    projectId: string
    title?: string | undefined
    mainThreadId: string
    modelRef?: string | undefined
    modelEffort?: string | undefined
    modelFast?: boolean | undefined
    routineId?: string | undefined
    message: { kind: string; payload: string }
  }): Promise<{ inboxId: number }> {
    const { message, ...session } = params
    return this.store.transact(async (tx) => {
      const at = await this.nowIn(tx)
      await createSessionIn({ tx, ...session, at })
      return postIn({
        tx,
        sessionId: params.sessionId,
        kind: message.kind,
        payload: message.payload,
        at,
      })
    })
  }

  async spawnPeer(params: {
    spawnerSessionId: string
    sessionId: string
    mainThreadId: string
    title?: string | undefined
    brief?: string | undefined
    nested?: boolean | undefined
  }): Promise<{ inboxId: number | null }> {
    return this.store.transact(async (tx) => {
      const spawner = await tx.readSession({
        sessionId: params.spawnerSessionId,
      })
      if (spawner === undefined) throw new Error(`unknown session ${params.spawnerSessionId}`)
      return spawnPeerIn({ tx, spawner, ...params, at: await this.nowIn(tx) })
    })
  }

  async messagePeer(params: {
    fromSessionId: string
    toSessionId: string
    text: string
  }): Promise<{ inboxId: number } | { refused: string }> {
    return this.store.transact(async (tx) => {
      const from = await tx.readSession({ sessionId: params.fromSessionId })
      if (from === undefined) throw new Error(`unknown session ${params.fromSessionId}`)
      return messagePeerIn({ tx, from, ...params, at: await this.nowIn(tx) })
    })
  }

  async messageTeammate(params: {
    fromSessionId: string
    toSessionId: string
    text: string
  }): Promise<{ inboxId: number } | { refused: string }> {
    return this.store.transact(async (tx) => {
      const from = await tx.readSession({ sessionId: params.fromSessionId })
      if (from === undefined) throw new Error(`unknown session ${params.fromSessionId}`)
      return messageTeammateIn({ tx, from, ...params, at: await this.nowIn(tx) })
    })
  }

  async reportToSpawner(params: {
    sessionId: string
    kind: EReportKind
    text: string
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

  async podPeersPlaced(params: {
    podSessionId: string
    excludeSessionId: string
  }): Promise<number> {
    return this.store.transact((tx) => tx.podPeersPlaced(params))
  }

  async readSession(params: { sessionId: string }): Promise<ControlSessionRow | undefined> {
    return this.store.transact((tx) => tx.readSession(params))
  }

  async setSessionArchived(params: { sessionId: string; archivedAt: string | null }) {
    await this.store.transact((tx) => archiveIn({ tx, ...params }))
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
    params: SessionListParams & { withView?: boolean | undefined },
  ): Promise<ControlSessionDigest[]> {
    const { withView, ...list } = params
    return this.store.transact(async (tx) =>
      withDigestViews({
        tx,
        leases: this.leases,
        rows: await tx.listSessionDigests({
          ...list,
          limit: clampSessionLimit(list.limit),
        }),
        now: await this.nowIn(tx),
        withView: withView === true,
        eventSchema: this.eventSchema,
        pluginViews: this.pluginViews,
      }),
    )
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
    await this.store.transact(async (tx) =>
      tx.createThread({
        ...params,
        visibility: EMPTY_VISIBILITY_TEXT,
        at: await this.nowIn(tx),
      }),
    )
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
          leases: this.leases,
          eventSchema: this.eventSchema,
          pluginViews: this.pluginViews,
          appendHooks: this.appendHooks,
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
    hiddenTypes?: readonly V2EventType[] | undefined
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

  async post(params: {
    sessionId: string
    kind: string
    payload: string
  }): Promise<{ inboxId: number }> {
    return this.store.transact(async (tx) => postIn({ tx, ...params, at: await this.nowIn(tx) }))
  }

  async takeBack(params: { sessionId: string; inboxId: number }): Promise<TakeBackResult> {
    return this.store.transact((tx) => takeBackIn({ tx, ...params }))
  }

  async readInboxEntry(params: {
    sessionId: string
    inboxId: number
  }): Promise<InboxEntry | undefined> {
    return this.store.transact((tx) => tx.readInboxEntry(params))
  }

  async readInbox(params: {
    sessionId: string
    afterId: number
    limit: number
  }): Promise<InboxEntry[]> {
    return this.store.transact((tx) =>
      tx.readInboxEntries({ ...params, limit: clampLimit(params.limit) }),
    )
  }

  async hasMessageAfter(params: {
    sessionId: string
    afterId: number
    excludeKind: string
  }): Promise<boolean> {
    const found = await this.store.transact((tx) => tx.readInboxEntries({ ...params, limit: 1 }))
    return found.length > 0
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

  async createRoutine(row: RoutineRow): Promise<RoutineRow> {
    return this.store.transact((tx) => createRoutineIn({ tx, row }))
  }

  async updateRoutine(params: {
    routineId: string
    userId: string
    patch: RoutinePatch
    nextRunAt?: string | undefined
    at: string
  }): Promise<RoutineRow | undefined> {
    return this.store.transact((tx) => updateRoutineIn({ tx, ...params }))
  }

  async deleteRoutine(params: { routineId: string; userId: string }): Promise<boolean> {
    return this.store.transact((tx) => deleteRoutineIn({ tx, ...params }))
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

  private async requireThread(params: { tx: ControlTx; threadId: string }): Promise<ThreadRow> {
    const row = await params.tx.readThread(params.threadId)
    if (row === undefined) throw new UnknownThreadError(params.threadId)
    return row
  }
}
