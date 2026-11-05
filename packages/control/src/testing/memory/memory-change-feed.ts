import type { SessionChange } from '@dltech/atlas-protocol'

import type { ChangeFeed } from '../../change-feed'

export class MemoryChangeFeed implements ChangeFeed {
  private readonly listeners = new Set<(change: SessionChange) => void>()
  private readonly delivered: SessionChange[] = []

  onChange(listener: (change: SessionChange) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  onGap(_listener: () => void): () => void {
    return () => undefined
  }

  publish(changes: readonly SessionChange[]): void {
    for (const change of changes) {
      this.delivered.push(change)
      for (const listener of [...this.listeners]) {
        try {
          listener(change)
        } catch {}
      }
    }
  }

  changesOf(sessionId: string): SessionChange[] {
    return this.delivered.filter((change) => change.sessionId === sessionId)
  }
}
