import { GENESIS_HASH, type InboxEntry, type Lease } from '@dltech/atlas-core'

import {
  ControlStorePort,
  SeqConflictError,
  type BlobRow,
  type BlobWrite,
  type ControlTx,
  type ReadEventsParams,
  type StoredEvent,
  type ThreadRow,
  type ControlSessionRow,
} from '../../port'

type SessionRow = ControlSessionRow & { nextInboxId: number }

type State = {
  sessions: Map<string, SessionRow>
  threads: Map<string, ThreadRow>
  events: Map<string, StoredEvent[]>
  eventIds: Set<string>
  leases: Map<string, Lease>
  inbox: Map<string, InboxEntry[]>
  blobs: Map<string, BlobRow>
}

const emptyState = (): State => ({
  sessions: new Map(),
  threads: new Map(),
  events: new Map(),
  eventIds: new Set(),
  leases: new Map(),
  inbox: new Map(),
  blobs: new Map(),
})

const cloneState = (state: State): State => ({
  sessions: new Map([...state.sessions].map(([key, value]) => [key, { ...value }])),
  threads: new Map([...state.threads].map(([key, value]) => [key, { ...value }])),
  events: new Map([...state.events].map(([key, value]) => [key, [...value]])),
  eventIds: new Set(state.eventIds),
  leases: new Map([...state.leases].map(([key, value]) => [key, { ...value }])),
  inbox: new Map([...state.inbox].map(([key, value]) => [key, value.map((e) => ({ ...e }))])),
  blobs: new Map([...state.blobs].map(([key, value]) => [key, { ...value }])),
})

const bisectAfter = (params: { rows: readonly StoredEvent[]; afterSeq: number }): number => {
  const { rows, afterSeq } = params
  let low = 0
  let high = rows.length
  while (low < high) {
    const mid = (low + high) >> 1
    if ((rows[mid] as StoredEvent).seq > afterSeq) high = mid
    else low = mid + 1
  }
  return low
}

const leaseLiveAt = (params: { lease: Lease | undefined; now: string }): boolean =>
  params.lease !== undefined &&
  params.lease.holderId !== null &&
  Date.parse(params.now) < Date.parse(params.lease.renewedAt) + params.lease.ttlMs

class MemoryTx implements ControlTx {
  private readonly state: State
  private readonly clock: () => string

  constructor(params: { state: State; clock: () => string }) {
    this.state = params.state
    this.clock = params.clock
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
      nextInboxId: 1,
    })
  }

  async readSession(params: { sessionId: string }): Promise<ControlSessionRow | undefined> {
    const row = this.state.sessions.get(params.sessionId)
    if (row === undefined) return undefined
    const { nextInboxId: _nextInboxId, ...session } = row
    return { ...session }
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

  async sessionsNeedingHolder(params: { now: string; limit: number }): Promise<string[]> {
    return [...this.state.sessions.values()]
      .filter((row) => {
        const lease = this.state.leases.get(row.sessionId)
        if (leaseLiveAt({ lease, now: params.now })) return false
        if (lease !== undefined && lease.holderId !== null) return true
        if (lease?.wantsHolder === true) return true
        return (this.state.inbox.get(row.sessionId) ?? []).some(
          (entry) => entry.consumedSeq === null,
        )
      })
      .sort(
        (a, b) =>
          Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
          a.sessionId.localeCompare(b.sessionId),
      )
      .slice(0, params.limit)
      .map((row) => row.sessionId)
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
    for (const row of rows) {
      const log = this.state.events.get(row.threadId)
      const last = log?.[log.length - 1]
      if (log === undefined || this.state.eventIds.has(row.id) || (last && last.seq >= row.seq)) {
        throw new SeqConflictError()
      }
      log.push(row)
      this.state.eventIds.add(row.id)
    }
  }

  async insertBlobs(rows: readonly BlobWrite[]): Promise<void> {
    for (const row of rows) {
      if (this.state.blobs.has(row.hash)) continue
      this.state.blobs.set(row.hash, {
        size: row.bytes.byteLength,
        bytes: new Uint8Array(row.bytes),
      })
    }
  }

  async readBlob(params: { hash: string }): Promise<BlobRow | undefined> {
    const row = this.state.blobs.get(params.hash)
    if (row === undefined) return undefined
    return { size: row.size, bytes: new Uint8Array(row.bytes) }
  }

  async readEvents(params: ReadEventsParams): Promise<StoredEvent[]> {
    const log = this.state.events.get(params.threadId) ?? []
    const out: StoredEvent[] = []
    for (
      let index = bisectAfter({ rows: log, afterSeq: params.afterSeq });
      index < log.length;
      index += 1
    ) {
      const row = log[index] as StoredEvent
      if (row.seq > params.throughSeq || out.length >= params.limit) break
      if (params.onlyTypes === undefined || params.onlyTypes.includes(row.type)) out.push(row)
    }
    return out
  }

  async readLease(sessionId: string): Promise<Lease | undefined> {
    const lease = this.state.leases.get(sessionId)
    return lease === undefined ? undefined : { ...lease }
  }

  async lockLease(sessionId: string): Promise<Lease | undefined> {
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
    const session = this.state.sessions.get(sessionId)
    if (session === undefined) throw new Error('unknown session')
    const id = session.nextInboxId
    session.nextInboxId += 1
    return id
  }

  async insertInboxEntry(entry: InboxEntry): Promise<void> {
    const list = this.state.inbox.get(entry.sessionId) ?? []
    list.push({ ...entry })
    this.state.inbox.set(entry.sessionId, list)
  }

  async readInboxEntry(params: { sessionId: string; inboxId: number }) {
    const found = this.state.inbox.get(params.sessionId)?.find((e) => e.inboxId === params.inboxId)
    return found === undefined ? undefined : { ...found }
  }

  async markInboxConsumed(params: {
    sessionId: string
    inboxId: number
    seq: number
  }): Promise<boolean> {
    const found = this.state.inbox.get(params.sessionId)?.find((e) => e.inboxId === params.inboxId)
    if (found === undefined || found.consumedSeq !== null) return false
    found.consumedSeq = params.seq
    return true
  }

  async deleteInboxEntry(params: { sessionId: string; inboxId: number }): Promise<boolean> {
    const list = this.state.inbox.get(params.sessionId) ?? []
    const index = list.findIndex((e) => e.inboxId === params.inboxId)
    const found = list[index]
    if (found === undefined || found.consumedSeq !== null) return false
    list.splice(index, 1)
    return true
  }

  async readInboxEntries(params: { sessionId: string; afterId: number; limit: number }) {
    return (this.state.inbox.get(params.sessionId) ?? [])
      .filter((e) => e.inboxId > params.afterId && e.consumedSeq === null)
      .sort((a, b) => a.inboxId - b.inboxId)
      .slice(0, params.limit)
      .map((e) => ({ ...e }))
  }
}

export class InMemoryControlStore extends ControlStorePort {
  private readonly clock: () => string
  private state: State = emptyState()
  private tail: Promise<unknown> = Promise.resolve()

  constructor(params: { clock?: (() => string) | undefined } = {}) {
    super()
    this.clock = params.clock ?? (() => new Date().toISOString())
  }

  transact<T>(work: (tx: ControlTx) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const working = cloneState(this.state)
      const result = await work(new MemoryTx({ state: working, clock: this.clock }))
      this.state = working
      return result
    }
    const next = this.tail.then(run, run)
    this.tail = next.catch(() => undefined)
    return next
  }
}
