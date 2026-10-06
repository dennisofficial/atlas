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
  private readonly remote: RemoteEventLog
  private readonly syncer: TranscriptSyncer
  private readonly rootThreadId: ThreadId
  private readonly listeners = new Set<() => void>()

  constructor(args: {
    channel: Pick<
      RemoteDeltaChannel,
      'subscribe' | 'onReload' | 'onReady' | 'request' | 'connection' | 'onConnection'
    >
    localLog: MirrorLocalLog
    writer: MirrorWriter
    threadId: ThreadId
    onSyncFailed?: ((failure: unknown) => void) | undefined
  }) {
    super()
    this.local = args.localLog
    this.remote = new RemoteEventLog({ channel: args.channel })
    this.syncer = new TranscriptSyncer({
      channel: args.channel,
      remote: this.remote,
      local: args.localLog,
      writer: args.writer,
      threadId: args.threadId,
      ...(args.onSyncFailed === undefined ? {} : { onSyncFailed: args.onSyncFailed }),
      onSynced: () => this.emit(),
    })
    this.rootThreadId = args.threadId
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
    if (args.threadId !== this.rootThreadId) return this.remote.read(args)
    const events = await this.local.read(args)
    this.syncer.kick()
    return events
  }

  async readOwn(args: {
    threadId: ThreadId
    fromSeq?: number | undefined
    upTo?: number | undefined
  }): Promise<Event[]> {
    if (args.threadId !== this.rootThreadId) return this.remote.readOwn(args)
    const events = await this.local.readOwn(args)
    this.syncer.kick()
    return events
  }

  async head(args: { threadId: ThreadId }): Promise<number> {
    if (args.threadId !== this.rootThreadId) return this.remote.head(args)
    const head = await this.local.head(args)
    this.syncer.kick()
    return head
  }

  async refresh(args: { threadId: ThreadId }): Promise<void> {
    await this.local.refresh(args)
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener()
  }

  /** The park flow awaits this before it writes the parked record, so the resume renders from a mirror the checkpoint has provably reached. */
  converge(): Promise<void> {
    return this.syncer.converge()
  }
}
