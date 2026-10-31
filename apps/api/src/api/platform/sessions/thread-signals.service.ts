import { db } from '@dltech/atlas-db'
import {
  EThreadListFrame,
  EThreadStreamFrame,
  type ThreadListActivity,
  type ThreadListFrame,
  type ThreadStreamFrame,
} from '@dltech/atlas-wire'
import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common'
import { BackgroundWork } from '../../../_core/ports/background-work'
import { ProcessBackgroundWork } from '../../../_lib/background-work/background-work.providers'
import { DrainStateService } from '../health/drain-state.service'
import { ThreadChangeRunner } from './thread-change-runner'
import { ThreadSubscription } from './thread-subscription'
import {
  InProcessThreadSignalBus,
  isListSignal,
  isProjectChangedSignal,
  isProjectRemovedSignal,
  isThreadChangedSignal,
  parseThreadSignal,
  ThreadSignalBus,
  type ListSignal,
  type ThreadChangedSignal,
  type ThreadSignal,
} from './thread-signal.bus'
import { ThreadLiveWatches, type LiveSignal } from './thread-live-watch'

export type { LiveSignal }

export type ThreadSignalPublisher = Pick<
  ThreadSignalsService,
  | 'headMoved'
  | 'podChanged'
  | 'titleChanged'
  | 'listChanged'
  | 'listChangedForOwner'
  | 'threadChanged'
>

type OpenStream = {
  onFrame: (frame: ThreadStreamFrame) => void
  onClosed: (() => void) | undefined
}

type OpenListStream = {
  onFrame: (frame: ThreadListFrame) => void
  onClosed: (() => void) | undefined
}

type OpenChangeWatch = {
  onChanged: (signal: ThreadChangedSignal) => void
}

const listFrameOf = (signal: ListSignal): ThreadListFrame =>
  signal.activity === undefined
    ? { type: EThreadListFrame.Changed, threadId: signal.threadId }
    : {
        type: EThreadListFrame.Changed,
        threadId: signal.threadId,
        activity: signal.activity,
      }

@Injectable()
export class ThreadSignalsService implements OnModuleDestroy {
  private readonly logger = new Logger(ThreadSignalsService.name)
  private readonly streams = new Map<string, Set<OpenStream>>()
  private readonly listStreams = new Map<string, Set<OpenListStream>>()
  private readonly changeWatches = new Map<string, Set<OpenChangeWatch>>()
  private readonly liveWatches = new ThreadLiveWatches()
  private readonly changeRunner = new ThreadChangeRunner()
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
    const entry: OpenStream = {
      onFrame: args.onFrame,
      onClosed: args.onClosed,
    }
    let entries = this.streams.get(args.threadId)
    if (entries === undefined) {
      entries = new Set()
      this.streams.set(args.threadId, entries)
    }
    entries.add(entry)
    this.subscription.ensureSubscribed()
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
    const entry: OpenListStream = {
      onFrame: args.onFrame,
      onClosed: args.onClosed,
    }
    let entries = this.listStreams.get(args.userId)
    if (entries === undefined) {
      entries = new Set()
      this.listStreams.set(args.userId, entries)
    }
    entries.add(entry)
    this.subscription.ensureSubscribed()
    return () => {
      entries.delete(entry)
      if (entries.size === 0) this.listStreams.delete(args.userId)
    }
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

  titleChanged(args: { threadId: string }): Promise<void> {
    return this.publish({
      threadId: args.threadId,
      frame: { type: EThreadStreamFrame.Title },
    })
  }

  async listChanged(args: {
    userId: string
    threadId: string
    activity?: ThreadListActivity
  }): Promise<void> {
    const { userId, threadId, activity } = args
    await this.publish(
      activity === undefined ? { userId, threadId } : { userId, threadId, activity },
    )
    this.threadChanged({ threadId })
  }

  async podChanged(args: { threadId: string }): Promise<void> {
    await this.publish({
      threadId: args.threadId,
      frame: { type: EThreadStreamFrame.Pod },
    })
    await this.listChangedForOwner(args)
  }

  async listChangedForOwner(args: {
    threadId: string
    activity?: ThreadListActivity
  }): Promise<void> {
    try {
      const row = await db.orm.public.Thread.where({ id: args.threadId }).select('userId').first()
      if (row !== null) await this.listChanged({ ...args, userId: row.userId })
    } catch (failure) {
      this.logger.warn(`resolving the owner of ${args.threadId} failed: ${String(failure)}`)
    }
  }

  closeAll(): void {
    const entries = [
      ...[...this.streams.values()].flatMap((open) => [...open]),
      ...[...this.listStreams.values()].flatMap((open) => [...open]),
      ...this.liveWatches.closedEntries(),
    ]
    this.streams.clear()
    this.listStreams.clear()
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
      return
    }
    if (isProjectChangedSignal(signal) || isProjectRemovedSignal(signal)) {
      this.liveWatches.fanOut({ signal })
      return
    }
    if (isListSignal(signal)) {
      for (const entry of this.listStreams.get(signal.userId) ?? []) {
        try {
          entry.onFrame(listFrameOf(signal))
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
