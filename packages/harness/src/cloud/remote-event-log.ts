import { EventLogPort, type Event, type EventDraft, type RunId, type ThreadId } from '@dltech/atlas-core'

import type { SessionsClient } from './sessions-client'
import { eventFromWire, wireDraftOf } from './session-wire'

export class RemoteEventLog extends EventLogPort {
  private readonly client: SessionsClient

  constructor(args: { client: SessionsClient }) {
    super()
    this.client = args.client
  }

  async append(args: {
    threadId: ThreadId
    runId: RunId
    parentRunId?: RunId | undefined
    depth?: number | undefined
    drafts: readonly EventDraft[]
  }): Promise<Event[]> {
    if (args.drafts.length === 0) return []

    const wire = await this.client.appendEvents({
      threadId: args.threadId,
      runId: args.runId,
      ...(args.parentRunId === undefined ? {} : { parentRunId: args.parentRunId }),
      ...(args.depth === undefined ? {} : { depth: args.depth }),
      drafts: args.drafts.map(wireDraftOf),
    })
    return wire.map(eventFromWire)
  }

  async replace(args: {
    threadId: ThreadId
    runId: RunId
    drafts: readonly EventDraft[]
  }): Promise<Event[]> {
    const wire = await this.client.replaceEvents({
      threadId: args.threadId,
      runId: args.runId,
      drafts: args.drafts.map(wireDraftOf),
    })
    return wire.map(eventFromWire)
  }

  async read(args: {
    threadId: ThreadId
    fromSeq?: number | undefined
    upTo?: number | undefined
  }): Promise<Event[]> {
    const wire = await this.client.readEvents({
      threadId: args.threadId,
      ...(args.upTo === undefined ? {} : { upTo: args.upTo }),
    })
    const events = wire.map(eventFromWire)
    if (args.fromSeq === undefined) return events
    const fromSeq = args.fromSeq
    return events.filter((event) => event.seq > fromSeq)
  }

  async readOwn(args: {
    threadId: ThreadId
    fromSeq?: number | undefined
    upTo?: number | undefined
  }): Promise<Event[]> {
    const wire = await this.client.readEvents({
      threadId: args.threadId,
      own: true,
      ...(args.upTo === undefined ? {} : { upTo: args.upTo }),
    })
    const events = wire.map(eventFromWire)
    if (args.fromSeq === undefined) return events
    const fromSeq = args.fromSeq
    return events.filter((event) => event.seq > fromSeq)
  }

  head(args: { threadId: ThreadId }): Promise<number> {
    return this.client.threadHead({ threadId: args.threadId })
  }
}
