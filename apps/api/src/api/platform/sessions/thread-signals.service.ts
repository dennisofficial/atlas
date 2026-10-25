import { EThreadStreamFrame, type ThreadStreamFrame } from '@dltech/atlas-wire'
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common'
import { DrainStateService } from '../health/drain-state.service'
import { InProcessThreadSignalBus, parseThreadSignal, ThreadSignalBus } from './thread-signal.bus'

export type ThreadSignalPublisher = Pick<ThreadSignalsService, 'headMoved' | 'podChanged'>

type OpenStream = {
  onFrame: (frame: ThreadStreamFrame) => void
  onClosed: (() => void) | undefined
}

@Injectable()
export class ThreadSignalsService implements OnModuleDestroy {
  private readonly logger = new Logger(ThreadSignalsService.name)
  private readonly streams = new Map<string, Set<OpenStream>>()
  private subscribed = false

  constructor(
    drain: DrainStateService,
    private readonly bus: ThreadSignalBus = new InProcessThreadSignalBus(),
  ) {
    drain.onDrain(() => this.closeAll())
  }

  async onModuleDestroy(): Promise<void> {
    this.closeAll()
    await this.bus.close()
  }

  openStream(args: {
    threadId: string
    onFrame: (frame: ThreadStreamFrame) => void
    onClosed?: () => void
  }): () => void {
    const entry: OpenStream = { onFrame: args.onFrame, onClosed: args.onClosed }
    let entries = this.streams.get(args.threadId)
    if (entries === undefined) {
      entries = new Set()
      this.streams.set(args.threadId, entries)
    }
    entries.add(entry)
    this.ensureSubscribed()
    return () => {
      entries.delete(entry)
      if (entries.size === 0) this.streams.delete(args.threadId)
    }
  }

  async publish(args: { threadId: string; frame: ThreadStreamFrame }): Promise<void> {
    try {
      await this.bus.publish({ threadId: args.threadId, frame: args.frame })
    } catch (failure) {
      this.logger.warn(`publishing a thread signal failed, dropping it: ${String(failure)}`)
    }
  }

  headMoved(args: { threadId: string; head: number }): Promise<void> {
    return this.publish({
      threadId: args.threadId,
      frame: { type: EThreadStreamFrame.Head, head: args.head },
    })
  }

  podChanged(args: { threadId: string }): Promise<void> {
    return this.publish({ threadId: args.threadId, frame: { type: EThreadStreamFrame.Pod } })
  }

  closeAll(): void {
    const entries = [...this.streams.values()].flatMap((open) => [...open])
    this.streams.clear()
    this.subscribed = false
    void this.bus.close().catch((failure: unknown) => {
      this.logger.warn(`closing the thread signal subscriber failed: ${String(failure)}`)
    })
    for (const entry of entries) {
      try {
        entry.onClosed?.()
      } catch (failure) {
        this.logger.warn(`closing a thread stream for drain failed: ${String(failure)}`)
      }
    }
  }

  private ensureSubscribed(): void {
    if (this.subscribed) return
    this.subscribed = true
    this.bus.subscribe({ onMessage: (raw) => this.handleMessage({ raw }) })
  }

  private handleMessage(args: { raw: string }): void {
    const signal = parseThreadSignal({ raw: args.raw })
    if (signal === undefined) {
      this.logger.warn('ignoring a malformed thread signal')
      return
    }
    for (const entry of this.streams.get(signal.threadId) ?? []) {
      try {
        entry.onFrame(signal.frame)
      } catch (failure) {
        this.logger.warn(`a thread stream handler failed: ${String(failure)}`)
      }
    }
  }
}
