import {
  loopStateOf,
  rowsOwnedBy,
  toEventId,
  type Event,
  type IdPort,
  type ThreadId,
} from '@dltech/atlas-core'

import { AgentRecordPort, ModelContextPort } from '../record/agent-record.port'

export type ContextWindow = (events: readonly Event[]) => readonly Event[]

export class InMemoryAgentRecord extends AgentRecordPort {
  private readonly byThread = new Map<ThreadId, Event[]>()
  private failure: unknown
  private tick = 0

  constructor(private readonly ids: Pick<IdPort, 'nextEventId'>) {
    super()
  }

  failNextAppend(error: unknown): void {
    this.failure = error
  }

  eventsOf(threadId: ThreadId): readonly Event[] {
    return this.byThread.get(threadId) ?? []
  }

  append: AgentRecordPort['append'] = async ({ threadId, runId, parentRunId, depth, drafts }) => {
    if (this.failure !== undefined) {
      const error = this.failure
      this.failure = undefined
      throw error
    }
    const log = this.byThread.get(threadId) ?? []
    const stamped = drafts.map(
      (draft): Event => ({
        ...draft,
        id: toEventId(String(this.ids.nextEventId())),
        seq: log.length + 1 + drafts.indexOf(draft),
        threadId,
        runId,
        ...(parentRunId === undefined ? {} : { parentRunId }),
        depth: depth ?? 0,
        at: new Date(this.tick++ * 1000).toISOString(),
      }),
    )
    this.byThread.set(threadId, [...log, ...stamped])
    return stamped
  }

  ownEvents: AgentRecordPort['ownEvents'] = async ({ threadId, afterSeq }) =>
    this.eventsOf(threadId).filter((event) => event.seq > (afterSeq ?? 0))

  composedEvents: AgentRecordPort['composedEvents'] = async ({ threadId }) => [
    ...this.eventsOf(threadId),
  ]

  loopState: AgentRecordPort['loopState'] = async ({ threadId }) =>
    loopStateOf({ events: rowsOwnedBy({ events: this.eventsOf(threadId), threadId }) })
}

export class InMemoryModelContext extends ModelContextPort {
  constructor(
    private readonly record: InMemoryAgentRecord,
    private readonly window: ContextWindow = (events) => events,
  ) {
    super()
  }

  read: ModelContextPort['read'] = async ({ threadId }) => ({
    events: this.window(this.record.eventsOf(threadId)),
  })
}
