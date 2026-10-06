import {
  findDivergence,
  type Event,
  type PrefixDigest,
  type ThreadId,
} from '@dltech/atlas-core'

import type { ChannelListener } from '../channel/delta-channel'
import { EClientRequest, transcriptIdentityReplySchema } from './channel-wire'
import type { MirrorWriter } from './mirror-writer'
import {
  EChannelConnection,
  type ChannelConnection,
  type ChannelReload,
  type RemoteDeltaChannel,
} from './remote-delta-channel'

export type MirrorLocalLog = {
  read(args: { threadId: ThreadId; fromSeq?: number | undefined; upTo?: number | undefined }): Promise<Event[]>
  readOwn(args: { threadId: ThreadId; fromSeq?: number | undefined; upTo?: number | undefined }): Promise<Event[]>
  head(args: { threadId: ThreadId }): Promise<number>
  refresh(args: { threadId: ThreadId }): Promise<void>
}

export type MirrorRemoteLog = {
  read(args: { threadId: ThreadId; fromSeq?: number | undefined; upTo?: number | undefined }): Promise<Event[]>
}

type SyncChannel = Pick<
  RemoteDeltaChannel,
  'subscribe' | 'onReload' | 'request' | 'connection' | 'onConnection'
>

export class TranscriptSyncer {
  private readonly args: {
    channel: SyncChannel
    remote: MirrorRemoteLog
    local: MirrorLocalLog
    writer: MirrorWriter
    threadId: ThreadId
    onSyncFailed?: ((failure: unknown) => void) | undefined
    onSynced?: (() => void) | undefined
  }
  private running = false
  private pending: 'tail' | 'verify' | null = null
  private connection: ChannelConnection
  private readonly settled = new Set<() => void>()

  constructor(args: {
    channel: SyncChannel
    remote: MirrorRemoteLog
    local: MirrorLocalLog
    writer: MirrorWriter
    threadId: ThreadId
    onSyncFailed?: ((failure: unknown) => void) | undefined
    onSynced?: (() => void) | undefined
  }) {
    this.args = args
    this.connection = args.channel.connection()
    args.channel.subscribe({
      threadId: args.threadId,
      listener: this.handleChannelSignal,
    })
    args.channel.onReload(this.handleReload)
    args.channel.onConnection(this.handleConnection)
  }

  kick(): void {
    this.enqueue({ mode: 'tail' })
  }

  /**
   * The park checkpoint waits on this: it resolves once every sync queued so far has landed on
   * disk, so the parked record vouches for what the local file provably holds rather than what
   * the last read happened to answer with. A parked channel has nothing to converge against —
   * it resolves at once and the record falls back to the safety-net digest read-back.
   */
  converge(): Promise<void> {
    this.enqueue({ mode: 'verify' })
    if (this.connection.state !== EChannelConnection.Open) return Promise.resolve()
    if (!this.running && this.pending === null) return Promise.resolve()
    return new Promise((resolve) => {
      this.settled.add(resolve)
    })
  }

  private readonly handleChannelSignal: ChannelListener = (signal) => {
    if (signal.type === 'events-appended') this.enqueue({ mode: 'tail' })
  }

  private readonly handleReload = (_reload: ChannelReload): void => {
    this.enqueue({ mode: 'verify' })
  }

  private readonly handleConnection = (connection: ChannelConnection): void => {
    const wasOpen = this.connection.state === EChannelConnection.Open
    this.connection = connection
    if (connection.state !== EChannelConnection.Open || wasOpen) return
    if (this.pending !== null && !this.running) {
      this.running = true
      void this.drain()
    }
  }

  private enqueue(args: { mode: 'tail' | 'verify' }): void {
    if (this.pending !== 'verify') this.pending = args.mode
    if (this.running) return
    this.running = true
    void this.drain()
  }

  private async drain(): Promise<void> {
    try {
      for (;;) {
        // A parked sandbox never answers, and nothing wakes it while the operator is away —
        // queued work waits for the connection to come back open rather than issue into it.
        if (this.connection.state !== EChannelConnection.Open) return
        const next = this.pending
        if (next === null) return
        this.pending = null
        try {
          if (next === 'verify') {
            await this.verify()
            continue
          }
          await this.tailSync()
        } catch (error) {
          // The mirror is best-effort: a parked or dropped wire rejects the read, and a writer can
          // fail on its own disk. Neither may crash the drain into an unhandled rejection — the
          // sync and anything queued behind it are dropped, reported once, and the next signal
          // re-queues fresh work against the live wire.
          this.pending = null
          this.args.onSyncFailed?.(error)
          return
        }
      }
    } finally {
      // A sync can die with the socket (park kills the wire mid-flight); whoever parked on
      // converge still needs its answer — the record falls back to the safety-net digest read-back.
      this.running = false
      for (const resolve of [...this.settled]) {
        this.settled.delete(resolve)
        resolve()
      }
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
    this.args.onSynced?.()
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
    this.args.onSynced?.()
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
