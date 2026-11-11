import type { SessionChange } from '@dltech/atlas-protocol'

import { MemoryChangeFeed } from './memory-change-feed'
import { prKey, type State } from './memory-state'
import type { InsertRoutineRunParams, PrStateRow, RoutineRow, SubscriptionLease } from '../../port'

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

  setPrState(row: PrStateRow): void {
    this.stateOf().prStates.set(prKey(row), { ...row })
  }

  setRoutine(row: RoutineRow): void {
    this.stateOf().routines.set(row.routineId, { ...row })
  }

  routineRuns(routineId: string): InsertRoutineRunParams[] {
    return this.stateOf()
      .routineRuns.filter((run) => run.routineId === routineId)
      .map((run) => ({ ...run }))
  }

  subscriptionLeases(): Array<SubscriptionLease & { expiresAt: string }> {
    return [...this.stateOf().subscriptionLeases.values()].map((lease) => ({ ...lease }))
  }

  changesOf(sessionId: string): SessionChange[] {
    return this.feed.changesOf(sessionId)
  }
}
