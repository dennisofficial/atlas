import {
  acceptAppend,
  stepVisibility,
  takeBack,
  visibleSegments,
  type InboxEntry,
  type InboxRefusal,
  type Lease,
  type LeaseResult,
  type LogHead,
  type V2Event,
} from '@dltech/atlas-core'

import { UnknownThreadError } from './errors'
import { LeaseOps } from './lease-ops'
import { parseAppendEvents } from './parse-append'
import {
  ControlStorePort,
  SeqConflictError,
  type ControlTx,
  type StoredEvent,
  type ThreadRow,
  type V2SessionRow,
} from './port'
import { consumeInbox } from './consume-inbox'
import { AppendAbort, type AppendOutcome, type ControlRefusal } from './refusal'
import {
  decodeStoredEvent,
  decodeVisibility,
  EMPTY_VISIBILITY_TEXT,
  encodeVisibility,
  toStoredEvent,
} from './stored-event'

export const MAX_READ_LIMIT = 1000
export const MAX_SESSION_LIST_LIMIT = 100

export type ControlPlaneParams = { store: ControlStorePort; clock?: (() => string) | undefined }

export type ReadEventsPage = { events: V2Event[]; next?: number }

export type TakeBackResult = { ok: true } | { ok: false; refusal: InboxRefusal }

const clampLimit = (limit: number): number => Math.max(1, Math.min(limit, MAX_READ_LIMIT))

const headOf = (row: ThreadRow): LogHead => ({ seq: row.headSeq, hash: row.headHash })

export class ControlPlane {
  private readonly store: ControlStorePort
  private readonly clock: (() => string) | undefined
  private readonly leases: LeaseOps

  constructor(params: ControlPlaneParams) {
    this.store = params.store
    this.clock = params.clock
    this.leases = new LeaseOps({ store: params.store, nowIn: (tx) => this.nowIn(tx) })
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
    })
  }

  async readSession(params: { sessionId: string }): Promise<V2SessionRow | undefined> {
    return this.store.transact((tx) => tx.readSession(params))
  }

  async listSessions(params: {
    userId: string
    projectId?: string | undefined
    limit: number
  }): Promise<V2SessionRow[]> {
    return this.store.transact((tx) =>
      tx.listSessions({
        ...params,
        limit: Math.max(1, Math.min(params.limit, MAX_SESSION_LIST_LIMIT)),
      }),
    )
  }

  async sessionsNeedingHolder(params: { limit: number }): Promise<string[]> {
    return this.store.transact(async (tx) =>
      tx.sessionsNeedingHolder({ now: await this.nowIn(tx), limit: clampLimit(params.limit) }),
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
  }): Promise<AppendOutcome> {
    try {
      return await this.store.transact((tx) => this.appendIn({ tx, ...params }))
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
  }): Promise<ReadEventsPage> {
    const limit = clampLimit(params.limit)
    return this.store.transact(async (tx) => {
      const row = await this.requireThread({ tx, threadId: params.threadId })
      const fromSeq = params.afterSeq + 1
      const segments = params.visible
        ? visibleSegments({
            state: decodeVisibility(row.visibility),
            fromSeq,
            throughSeq: row.headSeq,
          })
        : [{ fromSeq, throughSeq: row.headSeq }]
      const rows: StoredEvent[] = []
      for (const segment of segments) {
        if (rows.length >= limit) break
        const batch = await tx.readEvents({
          threadId: params.threadId,
          afterSeq: segment.fromSeq - 1,
          throughSeq: segment.throughSeq,
          limit: limit - rows.length,
          onlyTypes: 'onlyTypes' in segment ? segment.onlyTypes : undefined,
        })
        rows.push(...batch)
      }
      const events = rows.map(decodeStoredEvent)
      const last = events[events.length - 1]
      const more = last !== undefined && events.length === limit && last.seq < row.headSeq
      return more ? { events, next: last.seq } : { events }
    })
  }

  async post(params: {
    sessionId: string
    kind: string
    payload: string
  }): Promise<{ inboxId: number }> {
    return this.store.transact(async (tx) => {
      const inboxId = await tx.allocateInboxId(params.sessionId)
      await tx.insertInboxEntry({
        sessionId: params.sessionId,
        inboxId,
        kind: params.kind,
        payload: params.payload,
        postedAt: await this.nowIn(tx),
        consumedSeq: null,
      })
      return { inboxId }
    })
  }

  async takeBack(params: { sessionId: string; inboxId: number }): Promise<TakeBackResult> {
    return this.store.transact(async (tx) => {
      const entry = await tx.readInboxEntry(params)
      if (entry === undefined) return { ok: false, refusal: { kind: 'unknown-inbox-entry' } }
      const move = takeBack(entry)
      if (!move.ok) return move
      const deleted = await tx.deleteInboxEntry(params)
      return deleted ? { ok: true } : { ok: false, refusal: { kind: 'already-consumed' } }
    })
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

  async grant(params: { sessionId: string; holderId: string; ttlMs: number }): Promise<Lease> {
    return this.leases.grant(params)
  }

  async renew(params: {
    sessionId: string
    holderId: string
    epoch: number
  }): Promise<LeaseResult> {
    return this.leases.renew(params)
  }

  async revoke(params: { sessionId: string; wantsHolder: boolean }): Promise<Lease> {
    return this.leases.revoke(params)
  }

  async currentLease(params: { sessionId: string }): Promise<{ lease: Lease; live: boolean }> {
    return this.leases.currentLease(params)
  }

  private async requireThread(params: { tx: ControlTx; threadId: string }): Promise<ThreadRow> {
    const row = await params.tx.readThread(params.threadId)
    if (row === undefined) throw new UnknownThreadError(params.threadId)
    return row
  }

  private async appendIn(params: {
    tx: ControlTx
    threadId: string
    epoch: number
    events: readonly unknown[]
  }): Promise<AppendOutcome> {
    const { tx } = params
    const row = await tx.lockThread(params.threadId)
    if (row === undefined) throw new UnknownThreadError(params.threadId)
    const head = headOf(row)
    const refuse = (refusal: ControlRefusal): AppendOutcome => ({
      ok: false,
      refusal,
      head,
    })
    const now = await this.nowIn(tx)
    const lease = await this.leases.leaseOf({ tx, sessionId: row.sessionId, now })
    const parsed = parseAppendEvents({
      threadId: params.threadId,
      nextSeq: head.seq + 1,
      raw: params.events,
    })
    if (!parsed.ok) return refuse(parsed.refusal)
    const accepted = acceptAppend({
      head,
      lease,
      now,
      epoch: params.epoch,
      events: parsed.events,
    })
    if (!accepted.ok) return refuse(accepted.refusal)

    let visibility = decodeVisibility(row.visibility)
    const stored: StoredEvent[] = []
    for (const [index, event] of parsed.events.entries()) {
      visibility = stepVisibility(visibility, event)
      if (event.type === 'input-consumed') {
        await consumeInbox({
          tx,
          sessionId: row.sessionId,
          inboxId: event.inboxId,
          seq: event.seq,
          head,
        })
      }
      stored.push(toStoredEvent({ event, hash: accepted.hashes[index] as StoredEvent['hash'] }))
    }
    await tx.insertEvents(stored)
    const swapped = await tx.writeThreadHead({
      threadId: params.threadId,
      expectedHeadSeq: head.seq,
      headSeq: accepted.head.seq,
      headHash: accepted.head.hash,
      visibility: encodeVisibility(visibility),
    })
    if (!swapped) throw new SeqConflictError()
    return { ok: true, head: accepted.head }
  }
}
