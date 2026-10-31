import { EThreadStreamFrame, wireThreadSchema, type ThreadStreamFrame } from '@dltech/atlas-wire'
import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common'
import { BackgroundWork } from '../../../_core/ports/background-work'
import { ProcessBackgroundWork } from '../../../_lib/background-work/background-work.providers'
import { DrainStateService } from '../health/drain-state.service'
import { ThreadChangeRunner } from './thread-change-runner'
import { PodChangePublisher } from './pod-change-publisher'
import { publishEventChange, type EventsAppended, type EventsReset } from './event-change-publisher'
import { ThreadSubscription } from './thread-subscription'
import { registerFrameStream, type OpenStream, type OpenChangeWatch } from './thread-signal-entries'
import {
  InProcessThreadSignalBus,
  isProjectChangedSignal,
  isProjectRemovedSignal,
  isThreadChangedSignal,
  parseThreadSignal,
  ThreadSignalBus,
  type ThreadChangedSignal,
  type ThreadSignal,
} from './thread-signal.bus'
import { ThreadLiveWatches, type LiveSignal } from './thread-live-watch'

export type { LiveSignal }

export type ThreadSignalPublisher = Pick<
  ThreadSignalsService,
  'headMoved' | 'eventsAppended' | 'eventsReset' | 'podChanged' | 'threadChanged'
>

@Injectable()
export class ThreadSignalsService implements OnModuleDestroy {
  private readonly logger = new Logger(ThreadSignalsService.name)
  private readonly streams = new Map<string, Set<OpenStream>>()
  private readonly changeWatches = new Map<string, Set<OpenChangeWatch>>()
  private readonly liveWatches = new ThreadLiveWatches()
  private readonly changeRunner = new ThreadChangeRunner()
  private readonly podPublisher = new PodChangePublisher()
  private readonly subscription: ThreadSubscription

  constructor(
    drain: DrainStateService,
    private readonly bus: ThreadSignalBus = new InProcessThreadSignalBus(),
    @Inject(BackgroundWork)
    private readonly background: BackgroundWork = new ProcessBackgroundWork(),
  ) {
    this.subscription = new ThreadSubscription({
      bus,
      onMessage: (raw) => this.handleMessage({ raw }),
      onFailure: () => this.closeAll(),
    })
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
    const detach = registerFrameStream({ ...args, streams: this.streams, key: args.threadId })
    this.subscription.ensureSubscribed()
    return detach
  }

  watchThreadChanges(args: {
    userId: string
    onChanged: (signal: ThreadChangedSignal) => void
  }): () => void {
    const entry: OpenChangeWatch = { onChanged: args.onChanged }
    let entries = this.changeWatches.get(args.userId)
    if (entries === undefined) {
      entries = new Set()
      this.changeWatches.set(args.userId, entries)
    }
    entries.add(entry)
    this.subscription.ensureSubscribed()
    return () => {
      entries.delete(entry)
      if (entries.size === 0) this.changeWatches.delete(args.userId)
    }
  }

  watchLive(args: {
    userId: string
    onSignal: (signal: LiveSignal) => void
    onClosed?: () => void
  }): () => void {
    return this.liveWatches.watchLive({
      ...args,
      ensureSubscribed: () => this.subscription.ensureSubscribed(),
    })
  }

  threadChanged(args: { threadId: string }): void {
    this.changeRunner.threadChanged({
      threadId: args.threadId,
      background: this.background,
      publish: (signal) => this.publish(signal),
    })
  }

  changesSettled(): Promise<void> {
    return this.changeRunner.changesSettled()
  }

  async publish(args: ThreadSignal): Promise<void> {
    try {
      await this.bus.publish(args)
    } catch (failure) {
      this.logger.warn(`publishing a thread signal failed, dropping it: ${String(failure)}`)
    }
  }

  async headMoved(args: { threadId: string; head: number }): Promise<void> {
    await this.publish({
      threadId: args.threadId,
      frame: { type: EThreadStreamFrame.Head, head: args.head },
    })
    this.threadChanged({ threadId: args.threadId })
  }

  eventsAppended(change: EventsAppended): Promise<void> {
    return publishEventChange({
      change,
      publish: (signal) => this.publish(signal),
      threadChanged: () => this.threadChanged({ threadId: change.threadId }),
    })
  }

  eventsReset(change: EventsReset): Promise<void> {
    return publishEventChange({
      change,
      publish: (signal) => this.publish(signal),
      threadChanged: () => this.threadChanged({ threadId: change.threadId }),
    })
  }

  podChanged(args: { threadId: string }): Promise<void> {
    return this.podPublisher.publish({
      threadId: args.threadId,
      publish: (signal) => this.publish(signal),
      threadChanged: () => this.threadChanged({ threadId: args.threadId }),
    })
  }

  closeAll(): void {
    const entries = [
      ...[...this.streams.values()].flatMap((open) => [...open]),
      ...this.liveWatches.closedEntries(),
    ]
    this.streams.clear()
    this.changeWatches.clear()
    this.liveWatches.clear()
    this.subscription.reset()
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

  awaitSubscription(): Promise<void> {
    return this.subscription.awaitSubscription()
  }

  private handleMessage(args: { raw: string }): void {
    const signal = parseThreadSignal({ raw: args.raw })
    if (signal === undefined) {
      this.logger.warn('ignoring a malformed thread signal')
      return
    }
    if (isThreadChangedSignal(signal)) {
      for (const entry of this.changeWatches.get(signal.userId) ?? []) {
        try {
          entry.onChanged(signal)
        } catch (failure) {
          this.logger.warn(`a change watcher failed: ${String(failure)}`)
        }
      }
      this.liveWatches.fanOut({ signal })
      this.fanOut({
        threadId: signal.threadId,
        frame: {
          type: EThreadStreamFrame.Meta,
          thread: wireThreadSchema.parse(signal.thread),
          rev: signal.rev,
        },
      })
      return
    }
    if (isProjectChangedSignal(signal) || isProjectRemovedSignal(signal)) {
      this.liveWatches.fanOut({ signal })
      return
    }
    this.fanOut(signal)
  }

  private fanOut(signal: { threadId: string; frame: ThreadStreamFrame }): void {
    for (const entry of this.streams.get(signal.threadId) ?? []) {
      try {
        entry.onFrame(signal.frame)
      } catch (failure) {
        this.logger.warn(`a thread stream handler failed: ${String(failure)}`)
      }
    }
  }
}
