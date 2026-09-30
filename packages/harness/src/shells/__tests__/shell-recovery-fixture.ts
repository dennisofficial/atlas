import {
  stampDrafts,
  toCallId,
  toEventId,
  toRunId,
  toThreadId,
  type CallId,
  type Event,
  type EventDraft,
  type EventId,
  type EventLogPort,
  type EventEnvelope,
  type RunId,
  type ThreadId,
} from '@dltech/atlas-core'

export class SequenceIds {
  private handed = 0

  nextThreadId(): ThreadId {
    this.handed += 1
    return toThreadId(`thread-${this.handed}`)
  }

  nextCallId(): CallId {
    this.handed += 1
    return toCallId(`call-${this.handed}`)
  }

  nextRunId(): RunId {
    this.handed += 1
    return toRunId(`run-${this.handed}`)
  }

  nextEventId(): EventId {
    this.handed += 1
    return toEventId(`event-${this.handed}`)
  }
}

export class MemoryLog implements EventLogPort {
  readonly stored: Event[] = []
  failAppends = 0
  failReads = 0
  private seq = 0

  constructor(private readonly ids: SequenceIds) {}

  async append(args: {
    threadId: ThreadId
    runId: RunId
    parentRunId?: RunId | undefined
    depth?: number | undefined
    drafts: readonly EventDraft[]
  }): Promise<Event[]> {
    if (this.failAppends > 0) {
      this.failAppends -= 1
      throw new Error('append failed')
    }
    const envelopes: EventEnvelope[] = args.drafts.map(() => {
      this.seq += 1
      return {
        id: this.ids.nextEventId(),
        seq: this.seq,
        threadId: args.threadId,
        runId: args.runId,
        depth: args.depth ?? 0,
        at: '2026-09-24T00:00:00.000Z',
      }
    })
    const stamped = stampDrafts({ drafts: [...args.drafts], envelopes })
    this.stored.push(...stamped)
    return stamped
  }

  async replace(): Promise<Event[]> {
    throw new Error('unneeded')
  }

  async read(args: { threadId: ThreadId }): Promise<Event[]> {
    return this.stored.filter((event) => event.threadId === args.threadId)
  }

  async readOwn(args: { threadId: ThreadId }): Promise<Event[]> {
    if (this.failReads > 0) {
      this.failReads -= 1
      throw new Error('read failed')
    }
    return this.read(args)
  }

  async refresh(): Promise<void> {}
  async head(): Promise<number> {
    return this.seq
  }
}
