import type { Event, EventDraft, RunId, ThreadId } from '@dltech/atlas-core'

export abstract class AgentRecordPort {
  abstract append(args: {
    threadId: ThreadId
    runId: RunId
    parentRunId?: RunId | undefined
    depth?: number | undefined
    drafts: readonly EventDraft[]
  }): Promise<Event[]>

  abstract ownEvents(args: { threadId: ThreadId; afterSeq?: number }): Promise<Event[]>

  abstract composedEvents(args: { threadId: ThreadId }): Promise<Event[]>
}

export abstract class ModelContextPort {
  abstract read(args: { threadId: ThreadId }): Promise<{ events: readonly Event[] }>
}

export type AppendRecord = Pick<AgentRecordPort, 'append'>
