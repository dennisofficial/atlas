import type { Event, FactRecord, LoopState, RunId, ThreadId } from '@dltech/atlas-core'
import { ESpan, type TracePort } from '@dltech/atlas-observability'

import { AgentRecordPort } from '../record/agent-record.port'

export class TracedRecord extends AgentRecordPort {
  private readonly inner: AgentRecordPort
  private readonly trace: TracePort

  constructor(args: { inner: AgentRecordPort; trace: TracePort }) {
    super()
    this.inner = args.inner
    this.trace = args.trace
  }

  append(args: Parameters<AgentRecordPort['append']>[0]): Promise<Event[]> {
    return this.trace.span({
      name: ESpan.RecordAppend,
      fields: { threadId: args.threadId, drafts: args.drafts.length },
      run: () => this.inner.append(args),
    })
  }

  ownEvents(args: { threadId: ThreadId; afterSeq?: number | undefined }): Promise<Event[]> {
    return this.inner.ownEvents(args)
  }

  composedEvents(args: { threadId: ThreadId }): Promise<Event[]> {
    return this.inner.composedEvents(args)
  }

  loopState(args: { threadId: ThreadId }): Promise<LoopState> {
    return this.inner.loopState(args)
  }

  override queuedSince(): string | null {
    return this.inner.queuedSince?.() ?? null
  }

  override postedInputAts(args: { threadId: ThreadId }): Promise<ReadonlyMap<number, string>> {
    return this.inner.postedInputAts?.(args) ?? Promise.resolve(new Map())
  }

  override factsOfKind(args: { threadId: ThreadId; kind: string }): Promise<readonly FactRecord[]> {
    return this.inner.factsOfKind?.(args) ?? Promise.resolve([])
  }

  override appendFacts(args: {
    threadId: ThreadId
    runId: RunId
    facts: readonly FactRecord[]
  }): Promise<void> {
    return this.inner.appendFacts?.(args) ?? Promise.resolve()
  }
}
