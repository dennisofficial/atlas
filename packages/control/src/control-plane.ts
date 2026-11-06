import {
  type ClaimResult,
  type InboxEntry,
  type Lease,
  type LogHead,
  type RevokeResult,
} from '@dltech/atlas-core'

import { appendIn } from './append-ops'
import { readBlobIn } from './blob-ops'
import { UnknownThreadError } from './errors'
import { postIn, takeBackIn, type TakeBackResult } from './inbox-ops'
import { LeaseOps } from './lease-ops'
import {
  ControlStorePort,
  SeqConflictError,
  type BlobRow,
  type BlobWrite,
  type ControlTx,
  type ThreadRow,
  type ControlSessionDigest,
  type ControlSessionRow,
  type SessionListParams,
} from './port'
import { readEventsIn, type ReadEventsPage } from './read-events'
import { AppendAbort, type AppendOutcome } from './refusal'
import { readStatusSnapshotIn, type StatusSnapshot } from './status-snapshot'
import { EMPTY_VISIBILITY_TEXT } from './stored-event'

export const MAX_READ_LIMIT = 1000
export const MAX_SESSION_LIST_LIMIT = 100

export type ControlPlaneParams = { store: ControlStorePort; clock?: (() => string) | undefined }

export type { ReadEventsPage } from './read-events'
export type { TakeBackResult } from './inbox-ops'
export type { StatusSnapshot } from './status-snapshot'

const clampLimit = (limit: number): number => Math.max(1, Math.min(limit, MAX_READ_LIMIT))

const headOf = (row: ThreadRow): LogHead => ({ seq: row.headSeq, hash: row.headHash })

export class ControlPlane {
  private readonly store: ControlStorePort
  private readonly clock: (() => string) | undefined
  private readonly leases: LeaseOps

  constructor(params: ControlPlaneParams) {
    this.store = params.store
    this.clock = params.clock
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
  }): Promise<void> {
    await this.store.transact(async (tx) => {
      const at = await this.nowIn(tx)
      await tx.createSession({ ...params, at })
      await tx.createThread({
        threadId: params.mainThreadId,
        sessionId: params.sessionId,
        visibility: EMPTY_VISIBILITY_TEXT,
        at,
      })
      await tx.notifyWake(params.sessionId)
      await tx.announce({
        sessionId: params.sessionId,
        threadId: params.mainThreadId,
        headSeq: 0,
      })
    })
  }

  async readSession(params: { sessionId: string }): Promise<ControlSessionRow | undefined> {
    return this.store.transact((tx) => tx.readSession(params))
  }

  async setSessionArchived(params: {
    sessionId: string
    archivedAt: string | null
  }): Promise<void> {
    await this.store.transact(async (tx) => {
      if (!(await tx.setSessionArchived(params))) {
        throw new Error(`unknown session ${params.sessionId}`)
      }
    })
  }

  async listSessions(params: {
    userId: string
    projectId?: string | undefined
    limit: number
  }): Promise<ControlSessionRow[]> {
    return this.store.transact((tx) =>
      tx.listSessions({
        ...params,
        limit: Math.max(1, Math.min(params.limit, MAX_SESSION_LIST_LIMIT)),
      }),
    )
  }

  async listSessionDigests(params: SessionListParams): Promise<ControlSessionDigest[]> {
    return this.store.transact((tx) =>
      tx.listSessionDigests({
        ...params,
        limit: Math.max(1, Math.min(params.limit, MAX_SESSION_LIST_LIMIT)),
      }),
    )
  }

  async sessionsNeedingHolder(params: { limit: number }): Promise<string[]> {
    return this.store.transact((tx) =>
      tx.sessionsNeedingHolder({ limit: clampLimit(params.limit) }),
    )
  }

  async leasesHeldBy(params: { hostId: number; limit: number }): Promise<Lease[]> {
    return this.store.transact((tx) =>
      tx.leasesHeldBy({ hostId: params.hostId, limit: clampLimit(params.limit) }),
    )
  }

  async createThread(params: { threadId: string; sessionId: string }): Promise<void> {
    await this.store.transact(async (tx) =>
      tx.createThread({ ...params, visibility: EMPTY_VISIBILITY_TEXT, at: await this.nowIn(tx) }),
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
      return await this.store.transact((tx) => appendIn({ tx, leases: this.leases, ...params }))
    } catch (error) {
      if (error instanceof AppendAbort) {
        return { ok: false, refusal: error.refusal, head: error.head }
      }
      if (!(error instanceof SeqConflictError)) throw error
      const head = await this.head({ threadId: params.threadId })
      return { ok: false, refusal: { kind: 'seq-mismatch', expected: head.seq + 1 }, head }
    }
  }

  async readEvents(params: {
    threadId: string
    afterSeq: number
    limit: number
    visible: boolean
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
        maxBytes: params.maxBytes,
      })
    })
  }

  async readStatusSnapshot(params: {
    sessionId: string
    threadId: string
    eventLimit: number
  }): Promise<StatusSnapshot> {
    const eventLimit = clampLimit(params.eventLimit)
    return this.store.transact((tx) =>
      readStatusSnapshotIn({ tx, leases: this.leases, ...params, eventLimit }),
    )
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

  async claim(params: { sessionId: string; hostId: number }): Promise<ClaimResult> {
    return this.leases.claimLease(params)
  }

  revoke(params: { sessionId: string; wantsHolder: boolean }): Promise<Lease>
  revoke(params: { sessionId: string; wantsHolder: boolean; epoch: number }): Promise<RevokeResult>
  async revoke(params: {
    sessionId: string
    wantsHolder: boolean
    epoch?: number | undefined
  }): Promise<Lease | RevokeResult> {
    if (params.epoch === undefined) return this.leases.revoke(params)
    return this.leases.revokeIfEpoch({
      sessionId: params.sessionId,
      wantsHolder: params.wantsHolder,
      epoch: params.epoch,
    })
  }

  async currentLease(params: { sessionId: string }): Promise<{ lease: Lease; live: boolean }> {
    return this.leases.currentLease(params)
  }

  async wake(params: { sessionIds: readonly string[] }): Promise<void> {
    await this.store.transact(async (tx) => {
      for (const sessionId of params.sessionIds) {
        await tx.notifyWake(sessionId)
        await tx.announce({ sessionId })
      }
    })
  }

  async hostPresent(params: { hostId: number }): Promise<boolean> {
    return this.store.transact((tx) => tx.hostPresent(params.hostId))
  }

  private async requireThread(params: { tx: ControlTx; threadId: string }): Promise<ThreadRow> {
    const row = await params.tx.readThread(params.threadId)
    if (row === undefined) throw new UnknownThreadError(params.threadId)
    return row
  }
}
