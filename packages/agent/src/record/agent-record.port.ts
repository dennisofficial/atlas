import type { Event, EventDraft, LoopState, RunId, ThreadId } from '@dltech/atlas-core'

export abstract class AgentRecordPort {
  abstract append(args: {
    threadId: ThreadId
    runId: RunId
    parentRunId?: RunId | undefined
    depth?: number | undefined
    drafts: readonly EventDraft[]
    signal?: AbortSignal | undefined
  }): Promise<Event[]>

  abstract ownEvents(args: { threadId: ThreadId; afterSeq?: number | undefined }): Promise<Event[]>

  abstract composedEvents(args: { threadId: ThreadId }): Promise<Event[]>

  abstract loopState(args: { threadId: ThreadId }): Promise<LoopState>

  queuedSince(): string | null {
    return null
  }

  async postedInputAts(_args: { threadId: ThreadId }): Promise<ReadonlyMap<number, string>> {
    return new Map()
  }
}

export abstract class ModelContextPort {
  abstract read(args: { threadId: ThreadId }): Promise<{ events: readonly Event[] }>
}

export type AppendRecord = Pick<AgentRecordPort, 'append'>
