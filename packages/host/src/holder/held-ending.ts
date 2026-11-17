import { EHeldOutcome, type Lease, type ThreadId } from '@dltech/atlas-core'

import type { BranchObserver } from './branch-observer'
import type { HeldSessionDeps } from './held-session-deps'
import type { HeldTurns } from './held-turns'
import type { IdleDeadline } from './idle-deadline'
import type { SessionRuntime } from './ports'
import type { Reconciler } from './reconciler'
import type { SessionRecord } from './record/record-adapter'
import { startFailureOutcome } from './start-failure-record'

export class HeldEnding {
  private kind: EHeldOutcome | undefined
  private drive: (() => void) | undefined
  private wasReleased = false
  private epochOfLease = 0

  constructor(
    private readonly args: {
      sessionId: string
      deps: HeldSessionDeps
      lifetimeAbort: AbortController
      turns: HeldTurns
      idle: IdleDeadline
      isDraining(): boolean
      branches(): BranchObserver | undefined
      record(): SessionRecord | undefined
      runtime(): SessionRuntime | undefined
      reconciler(): Reconciler | undefined
    },
  ) {}

  get outcome(): EHeldOutcome | undefined {
    return this.kind
  }

  get released(): boolean {
    return this.wasReleased
  }

  get epoch(): number {
    return this.epochOfLease
  }

  begin(epoch: number): void {
    this.epochOfLease = epoch
  }

  waitForDrive(): Promise<void> {
    return new Promise<void>((resolve) => (this.drive = resolve))
  }

  async settleFault(args: { error: unknown; lease: Lease; threadId: ThreadId }): Promise<void> {
    if (this.args.reconciler() !== undefined || this.args.isDraining()) {
      return this.finish(EHeldOutcome.Faulted)
    }
    this.finish(await startFailureOutcome({ deps: this.args.deps, ...args }))
  }

  lose(kind: EHeldOutcome = EHeldOutcome.Fenced): void {
    if (this.args.lifetimeAbort.signal.aborted) return
    this.args.branches()?.stop()
    this.args.record()?.fence()
    this.args.runtime()?.remoteCalls.handoff()
    this.args.turns.abort()
    this.args.lifetimeAbort.abort()
    this.args.runtime()?.remoteCalls.close()
    this.finish(kind)
  }

  async releaseIdle(): Promise<void> {
    const runtime = this.args.runtime()
    if (runtime === undefined) return
    const current = await this.args.deps.plane.currentLease({ sessionId: this.args.sessionId })
    if (current.lease.epoch !== this.epochOfLease) return this.lose()
    await runtime.release()
    this.wasReleased = true
    this.finish(EHeldOutcome.Idle)
  }

  finish(kind: EHeldOutcome): void {
    if (this.kind !== undefined) return
    this.kind = kind
    this.args.idle.disarm()
    this.args.reconciler()?.stop()
    this.drive?.()
  }
}
