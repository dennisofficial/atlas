import { EventLogPort, type Event, type EventDraft, type RunId, type ThreadId } from '@dltech/atlas-core'

import { EClientRequest, readEventsReplySchema } from './channel-wire'
import type { RemoteDeltaChannel } from './remote-delta-channel'
import { eventFromWire } from './session-wire'

/**
 * The cloud transcript's read half: the sandbox's serve owns the on-disk JSONL log, so a read is a
 * channel request it answers from that log. Writes are refused outright — the loop running inside
 * the sandbox is the only writer, and a client that still tries to append has a stale wiring bug to
 * surface, not a request to relay.
 */
export class RemoteEventLog extends EventLogPort {
  private readonly channel: Pick<RemoteDeltaChannel, 'request'>

  constructor(args: { channel: Pick<RemoteDeltaChannel, 'request'> }) {
    super()
    this.channel = args.channel
  }

  append(_args: {
    threadId: ThreadId
    runId: RunId
    parentRunId?: RunId | undefined
    depth?: number | undefined
    drafts: readonly EventDraft[]
  }): Promise<Event[]> {
    return Promise.reject(
      new Error('the sandbox owns the transcript while lifted — reads only over the channel'),
    )
  }

  replace(_args: {
    threadId: ThreadId
    runId: RunId
    drafts: readonly EventDraft[]
  }): Promise<Event[]> {
    return Promise.reject(
      new Error('the sandbox owns the transcript while lifted — reads only over the channel'),
    )
  }

  async read(args: {
    threadId: ThreadId
    fromSeq?: number | undefined
    upTo?: number | undefined
  }): Promise<Event[]> {
    return await this.readEvents({ ...args, own: false })
  }

  async readOwn(args: {
    threadId: ThreadId
    fromSeq?: number | undefined
    upTo?: number | undefined
  }): Promise<Event[]> {
    return await this.readEvents({ ...args, own: true })
  }

  async head(args: { threadId: ThreadId }): Promise<number> {
    const events = await this.read({ threadId: args.threadId })
    return events.at(-1)?.seq ?? 0
  }

  private async readEvents(args: {
    threadId: ThreadId
    own: boolean
    fromSeq?: number | undefined
    upTo?: number | undefined
  }): Promise<Event[]> {
    const reply = readEventsReplySchema.parse(
      await this.channel.request({
        op: EClientRequest.ReadEvents,
        params: {
          threadId: args.threadId,
          ...(args.fromSeq === undefined ? {} : { fromSeq: args.fromSeq }),
          ...(args.upTo === undefined ? {} : { upTo: args.upTo }),
          ...(args.own ? { own: true } : {}),
        },
      }),
    )
    return reply.events.map(eventFromWire)
  }
}
