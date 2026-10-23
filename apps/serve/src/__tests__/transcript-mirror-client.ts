import type { Event, ThreadId } from '@dltech/atlas-core'
import {
  EConnectionView,
  mirrorWriter,
  type ChannelReload,
  type RemoteDeltaChannel,
  type RemoteEventLog,
} from '@dltech/atlas-harness'

type LocalLog = {
  refresh: (args: { threadId: ThreadId }) => Promise<void>
}

export class TranscriptMirrorClient {
  private running = false
  private again = false
  private readonly settled = new Set<() => void>()

  constructor(
    private readonly args: {
      channel: RemoteDeltaChannel
      remote: RemoteEventLog
      local: LocalLog
      home: string
      threadId: ThreadId
    },
  ) {
    args.channel.subscribe({
      threadId: args.threadId,
      listener: (signal) => {
        if (signal.type === 'events-appended') this.kick()
      },
    })
    args.channel.onReload((_reload: ChannelReload) => this.kick())
  }

  kick(): void {
    if (this.running) {
      this.again = true
      return
    }
    this.running = true
    void this.drain()
  }

  converge(): Promise<void> {
    this.kick()
    if (this.args.channel.connection().state !== EConnectionView.Connected) return Promise.resolve()
    return new Promise((resolve) => this.settled.add(resolve))
  }

  private async drain(): Promise<void> {
    try {
      do {
        this.again = false
        if (this.args.channel.connection().state !== EConnectionView.Connected) break
        const events: Event[] = await this.args.remote.read({ threadId: this.args.threadId })
        await mirrorWriter({ home: () => this.args.home }).rewriteFrom({
          threadId: this.args.threadId,
          fromSeq: 1,
          events,
        })
        await this.args.local.refresh({ threadId: this.args.threadId })
      } while (this.again)
    } catch {
      this.again = false
    } finally {
      this.running = false
      for (const resolve of [...this.settled]) {
        this.settled.delete(resolve)
        resolve()
      }
    }
  }
}
