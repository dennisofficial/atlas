import {
  EventLogPort,
  LogPort,
  stampDrafts,
  toEventId,
  toRunId,
  type Event,
  type EventDraft,
  type EventOfType,
  type LogEntry,
  type ThreadId,
} from '@dltech/atlas-core'

export class RecordingLog extends EventLogPort {
  readonly appended: EventDraft[] = []
  appending: (() => Promise<void>) | undefined
  private readonly stored: Event[] = []
  private seq = 0

  async append(args: { threadId: ThreadId; drafts: readonly EventDraft[] }): Promise<Event[]> {
    await this.appending?.()
    this.appended.push(...args.drafts)
    this.seq += 1
    const runId = toRunId(`run-${this.seq}`)
    let eventSeq = 0
    const envelopes = args.drafts.map(() => {
      eventSeq += 1
      return {
        id: toEventId(`event-${this.seq}-${eventSeq}`),
        seq: eventSeq,
        threadId: args.threadId,
        runId,
        depth: 0,
        at: '2026-09-26T00:00:00.000Z',
      }
    })
    const stamped = stampDrafts({ drafts: [...args.drafts], envelopes })
    this.stored.push(...stamped)
    return stamped
  }

  async read(args: { threadId: ThreadId }): Promise<Event[]> {
    return this.stored.filter((event) => event.threadId === args.threadId)
  }

  async readOwn(args: { threadId: ThreadId }): Promise<Event[]> {
    return this.read(args)
  }

  async refresh(): Promise<void> {}
  async head(): Promise<number> {
    return this.seq
  }

  async replace(): Promise<Event[]> {
    return []
  }
}

export const endedInLog = (
  log: RecordingLog | undefined,
): EventOfType<'background-shell-ended'>[] => {
  if (log === undefined) throw new Error('the registry was opened without a log')
  return log.appended.filter(
    (draft): draft is EventOfType<'background-shell-ended'> =>
      draft.type === 'background-shell-ended',
  )
}

export class RecordingOperations extends LogPort {
  readonly entries: LogEntry[] = []
  record(entry: LogEntry): void {
    this.entries.push(entry)
  }
}
