import { Logger } from '@nestjs/common'
import type {
  ProjectChangedSignal,
  ProjectRemovedSignal,
  ThreadChangedSignal,
} from './thread-signal.bus'

export type LiveSignal = ThreadChangedSignal | ProjectChangedSignal | ProjectRemovedSignal

type OpenLiveWatch = {
  onSignal: (signal: LiveSignal) => void
  onClosed: (() => void) | undefined
}

const logger = new Logger('ThreadLiveWatches')

export class ThreadLiveWatches {
  private readonly liveWatches = new Map<string, Set<OpenLiveWatch>>()

  watchLive(args: {
    userId: string
    onSignal: (signal: LiveSignal) => void
    onClosed?: () => void
    ensureSubscribed: () => void
  }): () => void {
    const entry: OpenLiveWatch = { onSignal: args.onSignal, onClosed: args.onClosed }
    let entries = this.liveWatches.get(args.userId)
    if (entries === undefined) {
      entries = new Set()
      this.liveWatches.set(args.userId, entries)
    }
    entries.add(entry)
    args.ensureSubscribed()
    return () => {
      entries.delete(entry)
      if (entries.size === 0) this.liveWatches.delete(args.userId)
    }
  }

  fanOut(args: { signal: LiveSignal }): void {
    for (const entry of this.liveWatches.get(args.signal.userId) ?? []) {
      try {
        entry.onSignal(args.signal)
      } catch (failure) {
        logger.warn(`a live watcher failed: ${String(failure)}`)
      }
    }
  }

  closedEntries(): OpenLiveWatch[] {
    return [...this.liveWatches.values()].flatMap((open) => [...open])
  }

  clear(): void {
    this.liveWatches.clear()
  }
}
