import {
  findDivergence,
  type Event,
  type PrefixDigest,
  type ThreadId,
} from '@dltech/atlas-core'

import type { ChannelListener } from '../channel/delta-channel'
import { EClientRequest, transcriptIdentityReplySchema } from './channel-wire'
import type { MirrorWriter } from './mirror-writer'
import type { ChannelReload, RemoteDeltaChannel } from './remote-delta-channel'

export type MirrorLocalLog = {
  read(args: { threadId: ThreadId; fromSeq?: number | undefined; upTo?: number | undefined }): Promise<Event[]>
  readOwn(args: { threadId: ThreadId; fromSeq?: number | undefined; upTo?: number | undefined }): Promise<Event[]>
  head(args: { threadId: ThreadId }): Promise<number>
  refresh(args: { threadId: ThreadId }): Promise<void>
}

export type MirrorRemoteLog = {
  read(args: { threadId: ThreadId; fromSeq?: number | undefined; upTo?: number | undefined }): Promise<Event[]>
}

type SyncChannel = Pick<RemoteDeltaChannel, 'subscribe' | 'onReload' | 'request'>

export class TranscriptSyncer {
  private readonly args: {
    channel: SyncChannel
    remote: MirrorRemoteLog
    local: MirrorLocalLog
    writer: MirrorWriter
    threadId: ThreadId
  }
  private running = false
  private pending: 'tail' | 'verify' | null = null

  constructor(args: {
    channel: SyncChannel
    remote: MirrorRemoteLog
    local: MirrorLocalLog
    writer: MirrorWriter
    threadId: ThreadId
  }) {
    this.args = args
    args.channel.subscribe({
      threadId: args.threadId,
      listener: this.handleChannelSignal,
    })
    args.channel.onReload(this.handleReload)
  }

  kick(): void {
    this.enqueue({ mode: 'tail' })
  }

  private readonly handleChannelSignal: ChannelListener = (signal) => {
    if (signal.type === 'events-appended') this.enqueue({ mode: 'tail' })
  }

  private readonly handleReload = (_reload: ChannelReload): void => {
    this.enqueue({ mode: 'verify' })
  }

  private enqueue(args: { mode: 'tail' | 'verify' }): void {
    if (this.pending !== 'verify') this.pending = args.mode
    if (this.running) return
    this.running = true
    void this.drain()
  }

  private async drain(): Promise<void> {
    for (;;) {
      const next = this.pending
      if (next === null) {
        this.running = false
        return
      }
      this.pending = null
      if (next === 'verify') {
        await this.verify()
        continue
      }
      await this.tailSync()
    }
  }

  private async tailSync(): Promise<void> {
    const localHead = await this.args.local.head({ threadId: this.args.threadId })
    const events = await this.args.remote.read({ threadId: this.args.threadId, fromSeq: localHead })
    if (events.length === 0) return
    const first = events[0]
    if (first === undefined) return
    if (first.seq !== localHead + 1) {
      await this.verify()
      return
    }
    await this.args.writer.appendDelta({ threadId: this.args.threadId, events })
    await this.args.local.refresh({ threadId: this.args.threadId })
  }

  private async verify(): Promise<void> {
    const localEvents = await this.args.local.readOwn({ threadId: this.args.threadId })
    const divergence = await findDivergence({ local: localEvents, remoteDigest: this.remoteDigest })
    if (divergence === null) return
    const events = await this.args.remote.read({
      threadId: this.args.threadId,
      fromSeq: divergence - 1,
    })
    await this.args.writer.rewriteFrom({
      threadId: this.args.threadId,
      fromSeq: divergence,
      events,
    })
    await this.args.local.refresh({ threadId: this.args.threadId })
  }

  private readonly remoteDigest: PrefixDigest = async (upTo) => {
    const reply = transcriptIdentityReplySchema.parse(
      await this.args.channel.request({
        op: EClientRequest.ReadTranscriptIdentity,
        params: { threadId: this.args.threadId, upTo },
      }),
    )
    return reply
  }
}
