import type { SessionChange } from '@dltech/atlas-protocol'

import type { ChangeFeed } from '../../change-feed'
import { ControlStorePort, type ControlTx } from '../../port'
import { MemoryChangeFeed } from './memory-change-feed'
import { cloneState, emptyState, type State } from './memory-state'
import { MemoryTx } from './memory-tx'

export class InMemoryControlStore extends ControlStorePort implements ChangeFeed {
  private readonly clock: () => string
  private state: State = emptyState()
  private tail: Promise<unknown> = Promise.resolve()
  private readonly presentHosts = new Set<number>()
  private lastHostId = 0
  private readonly feed = new MemoryChangeFeed()

  constructor(params: { clock?: (() => string) | undefined } = {}) {
    super()
    this.clock = params.clock ?? (() => new Date().toISOString())
  }

  transact<T>(work: (tx: ControlTx) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const working = cloneState(this.state)
      const pending: SessionChange[] = []
      const result = await work(
        new MemoryTx({
          state: working,
          clock: this.clock,
          presentHosts: this.presentHosts,
          pending,
        }),
      )
      this.state = working
      this.feed.publish(pending)
      return result
    }
    const next = this.tail.then(run, run)
    this.tail = next.catch(() => undefined)
    return next
  }

  nextHostId(): number {
    this.lastHostId += 1
    return this.lastHostId
  }

  markHostPresent(hostId: number): void {
    this.presentHosts.add(hostId)
  }

  markHostAbsent(hostId: number): void {
    this.presentHosts.delete(hostId)
  }

  wakeCount(sessionId: string): number {
    return this.state.notifications.filter((id) => id === sessionId).length
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
