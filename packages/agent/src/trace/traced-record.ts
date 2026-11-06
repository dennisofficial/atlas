import type { Event, LoopState, ThreadId } from '@dltech/atlas-core'
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
    return this.read({ threadId: args.threadId, run: () => this.inner.ownEvents(args) })
  }

  composedEvents(args: { threadId: ThreadId }): Promise<Event[]> {
    return this.read({ threadId: args.threadId, run: () => this.inner.composedEvents(args) })
  }

  loopState(args: { threadId: ThreadId }): Promise<LoopState> {
    return this.trace.span({
      name: ESpan.RecordRead,
      fields: { threadId: args.threadId },
      run: () => this.inner.loopState(args),
    })
  }

  private read(args: { threadId: ThreadId; run: () => Promise<Event[]> }): Promise<Event[]> {
    return this.trace.span({
      name: ESpan.RecordRead,
      fields: { threadId: args.threadId },
      run: async (span) => {
        const events = await args.run()
        span.set({ events: events.length })
        return events
      },
    })
  }
}
