import { GENESIS_HASH, type InboxEntry, type Lease } from '@dltech/atlas-core'

import {
  ControlStorePort,
  SeqConflictError,
  type ControlTx,
  type ReadEventsParams,
  type StoredEvent,
  type ThreadRow,
} from '../../port'

type SessionRow = { nextInboxId: number }

type State = {
  sessions: Map<string, SessionRow>
  threads: Map<string, ThreadRow>
  events: Map<string, StoredEvent[]>
  eventIds: Set<string>
  leases: Map<string, Lease>
  inbox: Map<string, InboxEntry[]>
}

const emptyState = (): State => ({
  sessions: new Map(),
  threads: new Map(),
  events: new Map(),
  eventIds: new Set(),
  leases: new Map(),
  inbox: new Map(),
})

const cloneState = (state: State): State => ({
  sessions: new Map([...state.sessions].map(([key, value]) => [key, { ...value }])),
  threads: new Map([...state.threads].map(([key, value]) => [key, { ...value }])),
  events: new Map([...state.events].map(([key, value]) => [key, [...value]])),
  eventIds: new Set(state.eventIds),
  leases: new Map([...state.leases].map(([key, value]) => [key, { ...value }])),
  inbox: new Map([...state.inbox].map(([key, value]) => [key, value.map((e) => ({ ...e }))])),
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

class MemoryTx implements ControlTx {
  constructor(private readonly state: State) {}

  async createSession(params: { sessionId: string }): Promise<void> {
    if (this.state.sessions.has(params.sessionId)) throw new Error('session exists')
    this.state.sessions.set(params.sessionId, { nextInboxId: 1 })
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
  private state: State = emptyState()
  private tail: Promise<unknown> = Promise.resolve()

  transact<T>(work: (tx: ControlTx) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const working = cloneState(this.state)
      const result = await work(new MemoryTx(working))
      this.state = working
      return result
    }
    const next = this.tail.then(run, run)
    this.tail = next.catch(() => undefined)
    return next
  }
}
