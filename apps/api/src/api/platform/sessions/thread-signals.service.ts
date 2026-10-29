import { db } from '@dltech/atlas-db'
import {
  EThreadListFrame,
  EThreadStreamFrame,
  type ThreadListFrame,
  type ThreadStreamFrame,
} from '@dltech/atlas-wire'
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common'
import { DrainStateService } from '../health/drain-state.service'
import {
  InProcessThreadSignalBus,
  isListSignal,
  parseThreadSignal,
  ThreadSignalBus,
  type ThreadSignal,
} from './thread-signal.bus'

export type ThreadSignalPublisher = Pick<
  ThreadSignalsService,
  'headMoved' | 'podChanged' | 'listChanged' | 'listChangedForOwner'
>

type OpenStream = {
  onFrame: (frame: ThreadStreamFrame) => void
  onClosed: (() => void) | undefined
}

type OpenListStream = {
  onFrame: (frame: ThreadListFrame) => void
  onClosed: (() => void) | undefined
}

@Injectable()
export class ThreadSignalsService implements OnModuleDestroy {
  private readonly logger = new Logger(ThreadSignalsService.name)
  private readonly streams = new Map<string, Set<OpenStream>>()
  private readonly listStreams = new Map<string, Set<OpenListStream>>()
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

  openListStream(args: {
    userId: string
    onFrame: (frame: ThreadListFrame) => void
    onClosed?: () => void
  }): () => void {
    const entry: OpenListStream = { onFrame: args.onFrame, onClosed: args.onClosed }
    let entries = this.listStreams.get(args.userId)
    if (entries === undefined) {
      entries = new Set()
      this.listStreams.set(args.userId, entries)
    }
    entries.add(entry)
    this.ensureSubscribed()
    return () => {
      entries.delete(entry)
      if (entries.size === 0) this.listStreams.delete(args.userId)
    }
  }

  async publish(args: ThreadSignal): Promise<void> {
    try {
      await this.bus.publish(args)
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

  listChanged(args: { userId: string; threadId: string }): Promise<void> {
    return this.publish({ userId: args.userId, threadId: args.threadId })
  }

  async podChanged(args: { threadId: string }): Promise<void> {
    await this.publish({ threadId: args.threadId, frame: { type: EThreadStreamFrame.Pod } })
    await this.listChangedForOwner(args)
  }

  async listChangedForOwner(args: { threadId: string }): Promise<void> {
    try {
      const row = await db.orm.public.Thread.where({ id: args.threadId }).select('userId').first()
      if (row !== null) await this.listChanged({ userId: row.userId, threadId: args.threadId })
    } catch (failure) {
      this.logger.warn(`resolving the owner of ${args.threadId} failed: ${String(failure)}`)
    }
  }

  closeAll(): void {
    const entries = [
      ...[...this.streams.values()].flatMap((open) => [...open]),
      ...[...this.listStreams.values()].flatMap((open) => [...open]),
    ]
    this.streams.clear()
    this.listStreams.clear()
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
    if (isListSignal(signal)) {
      for (const entry of this.listStreams.get(signal.userId) ?? []) {
        try {
          entry.onFrame({ type: EThreadListFrame.Changed, threadId: signal.threadId })
        } catch (failure) {
          this.logger.warn(`a list stream handler failed: ${String(failure)}`)
        }
      }
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
