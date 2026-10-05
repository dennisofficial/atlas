import {
  EventLogPort,
  type Event,
  type EventDraft,
  type RunId,
  type ThreadId,
} from '@dltech/atlas-core'

import type { MirrorWriter } from './mirror-writer'
import { RemoteEventLog } from './remote-event-log'
import type { RemoteDeltaChannel } from './remote-delta-channel'
import { TranscriptSyncer, type MirrorLocalLog } from './transcript-syncer'

export class MirroredEventLog extends EventLogPort {
  private readonly local: MirrorLocalLog
  private readonly syncer: TranscriptSyncer

  constructor(args: {
    channel: Pick<RemoteDeltaChannel, 'subscribe' | 'onReload' | 'onReady' | 'request'>
    localLog: MirrorLocalLog
    writer: MirrorWriter
    threadId: ThreadId
  }) {
    super()
    this.local = args.localLog
    this.syncer = new TranscriptSyncer({
      channel: args.channel,
      remote: new RemoteEventLog({ channel: args.channel }),
      local: args.localLog,
      writer: args.writer,
      threadId: args.threadId,
    })
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
    const events = await this.local.read(args)
    this.syncer.kick()
    return events
  }

  async readOwn(args: {
    threadId: ThreadId
    fromSeq?: number | undefined
    upTo?: number | undefined
  }): Promise<Event[]> {
    const events = await this.local.readOwn(args)
    this.syncer.kick()
    return events
  }

  async head(args: { threadId: ThreadId }): Promise<number> {
    const head = await this.local.head(args)
    this.syncer.kick()
    return head
  }

  async refresh(args: { threadId: ThreadId }): Promise<void> {
    await this.local.refresh(args)
  }
}
