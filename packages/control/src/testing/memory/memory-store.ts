import type { SessionChange } from '@dltech/atlas-protocol'

import type { ChangeFeed } from '../../change-feed'
import { ControlStorePort, type ControlTx, type PrStateRow } from '../../port'
import { MemoryTx } from './memory-tx'
import { MemoryTestControls } from './memory-test-controls'
import { cloneState, emptyState, type State } from './memory-state'

export class InMemoryControlStore extends ControlStorePort implements ChangeFeed {
  private readonly clock: () => string
  private state: State = emptyState()
  private tail: Promise<unknown> = Promise.resolve()
  private readonly controls = new MemoryTestControls(() => this.state)

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
          presentHosts: this.controls.presentHosts,
          pending,
        }),
      )
      this.state = working
      this.controls.feed.publish(pending)
      return result
    }
    const next = this.tail.then(run, run)
    this.tail = next.catch(() => undefined)
    return next
  }

  nextHostId(): number {
    return this.controls.nextHostId()
  }

  markHostPresent(hostId: number): void {
    this.controls.presentHosts.add(hostId)
  }

  markHostAbsent(hostId: number): void {
    this.controls.presentHosts.delete(hostId)
  }

  wakeCount(sessionId: string): number {
    return this.controls.wakeCount(sessionId)
  }

  onChange(listener: (change: SessionChange) => void): () => void {
    return this.controls.onChange(listener)
  }

  onGap(listener: () => void): () => void {
    return this.controls.onGap(listener)
  }

  setPrState(row: PrStateRow): void {
    this.controls.setPrState(row)
  }

  changesOf(sessionId: string): SessionChange[] {
    return this.controls.changesOf(sessionId)
  }
}
