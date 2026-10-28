import {
  EventLogPort,
  stampDrafts,
  toEventId,
  toRunId,
  type Event,
  type EventDraft,
  type ThreadId,
} from '@dltech/atlas-core'

export class MemoryLog extends EventLogPort {
  readonly stored: Event[] = []
  failing: Error | undefined
  private seq = 0

  async append(args: { threadId: ThreadId; drafts: readonly EventDraft[] }): Promise<Event[]> {
    if (this.failing !== undefined) throw this.failing
    const envelopes = args.drafts.map(() => {
      this.seq += 1
      return {
        id: toEventId(`event-${this.seq}`),
        seq: this.seq,
        threadId: args.threadId,
        runId: toRunId(`run-${this.seq}`),
        depth: 0,
        at: '2026-10-28T12:00:00.000Z',
      }
    })
    const stamped = stampDrafts({ drafts: [...args.drafts], envelopes })
    this.stored.push(...stamped)
    return stamped
  }

  ofType(type: EventDraft['type'], threadId?: ThreadId): Event[] {
    return this.stored.filter(
      (event) => event.type === type && (threadId === undefined || event.threadId === threadId),
    )
  }

  truncate(args: { threadId: ThreadId; toSeq: number }): void {
    const kept = this.stored.filter(
      (event) => event.threadId !== args.threadId || event.seq <= args.toSeq,
    )
    this.stored.splice(0, this.stored.length, ...kept)
  }

  async read(args: { threadId: ThreadId }): Promise<Event[]> {
    return this.stored.filter((event) => event.threadId === args.threadId)
  }
  async readOwn(args: { threadId: ThreadId }): Promise<Event[]> {
    return this.read(args)
  }
  async replace(): Promise<Event[]> {
    return []
  }
  async refresh(): Promise<void> {}
  async head(): Promise<number> {
    return this.seq
  }
}
