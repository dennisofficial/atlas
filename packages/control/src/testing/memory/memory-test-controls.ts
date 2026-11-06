import type { SessionChange } from '@dltech/atlas-protocol'

import { MemoryChangeFeed } from './memory-change-feed'
import type { State } from './memory-state'

export class MemoryTestControls {
  private lastHostId = 0
  readonly presentHosts = new Set<number>()
  readonly feed = new MemoryChangeFeed()

  constructor(private readonly stateOf: () => State) {}

  nextHostId(): number {
    this.lastHostId += 1
    return this.lastHostId
  }

  wakeCount(sessionId: string): number {
    return this.stateOf().notifications.filter((id) => id === sessionId).length
  }

  onChange(listener: (change: SessionChange) => void): () => void {
    return this.feed.onChange(listener)
  }

  onGap(listener: () => void): () => void {
    return this.feed.onGap(listener)
  }

  changesOf(sessionId: string): SessionChange[] {
    return this.feed.changesOf(sessionId)
  }
}
