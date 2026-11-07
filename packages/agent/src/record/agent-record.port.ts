import type { Event, EventDraft, LoopState, RunId, ThreadId } from '@dltech/atlas-core'

export abstract class AgentRecordPort {
  abstract append(args: {
    threadId: ThreadId
    runId: RunId
    parentRunId?: RunId | undefined
    depth?: number | undefined
    drafts: readonly EventDraft[]
  }): Promise<Event[]>

  abstract ownEvents(args: { threadId: ThreadId; afterSeq?: number | undefined }): Promise<Event[]>

  abstract composedEvents(args: { threadId: ThreadId }): Promise<Event[]>

  abstract loopState(args: { threadId: ThreadId }): Promise<LoopState>
}

export abstract class ModelContextPort {
  abstract read(args: { threadId: ThreadId }): Promise<{ events: readonly Event[] }>
}

export type AppendRecord = Pick<AgentRecordPort, 'append'>
