import { PauseSignal } from '@dltech/atlas-agent'
import type { EKilledBy, ThreadId } from '@dltech/atlas-core'

import type { HeldSessionDeps } from '../held-session-deps'
import type { SessionRecord } from '../record/record-adapter'
import { oweChildStoppedCalls } from '../stop-debts'
import { drainChildTurn } from './child-drain'

export type ChildLifecycleArgs = {
  readonly agentId: ThreadId
  readonly deps: Pick<HeldSessionDeps, 'timers' | 'drainCapMs' | 'ids' | 'log'>
  readonly parentRecord: SessionRecord
  readonly record: () => SessionRecord
  readonly done: () => Promise<void>
}

export class ChildLifecycle {
  readonly pauseSignal = new PauseSignal()
  private stopRequested = false
  private handOffRequested = false
  private killing: EKilledBy | undefined
  private pausing: Promise<void> | undefined
  private abort: AbortController | undefined

  constructor(private readonly args: ChildLifecycleArgs) {}

  get stopping(): boolean {
    return this.stopRequested
  }

  get handingOff(): boolean {
    return this.handOffRequested
  }

  get killedBy(): EKilledBy | undefined {
    return this.killing
  }

  attach(abort: AbortController): void {
    this.abort = abort
  }

  release(): void {
    this.abort = undefined
  }

  abortWith(reason: string): void {
    this.abort?.abort(reason)
  }

  stop(by: EKilledBy): Promise<void> {
    this.stopRequested = true
    this.killing = by
    const owed = this.oweStoppedCalls()
    this.abortWith('agent_stop')
    return owed
  }

  handoff(): void {
    this.handOffRequested = true
    this.abortWith('handoff')
  }

  pause(): Promise<void> {
    this.handOffRequested = true
    this.pauseSignal.pause()
    this.pausing ??= drainChildTurn({
      timers: this.args.deps.timers,
      drainCapMs: this.args.deps.drainCapMs,
      agentId: this.args.agentId,
      pause: this.pauseSignal,
      done: this.args.done(),
      ...(this.args.deps.log === undefined ? {} : { log: this.args.deps.log }),
    })
    return this.pausing
  }

  reset(): void {
    this.stopRequested = false
    this.killing = undefined
  }

  private oweStoppedCalls(): Promise<void> {
    return oweChildStoppedCalls({
      child: this.args.record(),
      parent: this.args.parentRecord,
      runId: () => this.args.deps.ids.nextRunId(),
      ...(this.args.deps.log === undefined ? {} : { log: this.args.deps.log }),
    })
  }
}
