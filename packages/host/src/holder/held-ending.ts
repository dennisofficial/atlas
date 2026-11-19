import {
  EHeldOutcome,
  type InboxEntry,
  type Lease,
  type PrepareFailure,
  type ThreadId,
} from '@dltech/atlas-core'
import { idleReleaseGuardOf, type IdleReleaseGuard } from '@dltech/atlas-control'
import { logFieldsOf } from '@dltech/atlas-observability'

import type { BranchObserver } from './branch-observer'
import { drainNeedsHolder } from './held-needs-holder'
import type { HeldSessionDeps } from './held-session-deps'
import type { HeldTurns } from './held-turns'
import type { SessionRuntime } from './ports'
import type { Reconciler } from './reconciler'
import type { SessionRecord } from './record/record-adapter'
import { startFailureOutcome } from './start-failure-record'

export class HeldEnding {
  private kind: EHeldOutcome | undefined
  private drive: (() => void) | undefined
  private wasReleased = false
  private handedBack = false
  private epochOfLease = 0

  constructor(
    private readonly args: {
      sessionId: string
      deps: HeldSessionDeps
      lifetimeAbort: AbortController
      turns: HeldTurns
      isDraining(): boolean
      branches(): BranchObserver | undefined
      record(): SessionRecord | undefined
      runtime(): SessionRuntime | undefined
      reconciler(): Reconciler | undefined
      beforeRelease(): Promise<void>
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

  async releaseIdle(args: {
    entries: readonly InboxEntry[]
    failure: PrepareFailure | undefined
    threadId: ThreadId
  }): Promise<void> {
    const runtime = this.args.runtime()
    if (runtime === undefined) return
    const current = await this.args.deps.plane.currentLease({ sessionId: this.args.sessionId })
    if (current.lease.epoch !== this.epochOfLease) return this.lose()
    const guard = idleReleaseGuardOf({
      entries: args.entries,
      failure: args.failure,
      wantsHolder: current.lease.wantsHolder,
    })
    if (guard.reasons.length > 0) {
      this.args.deps.log?.warn({
        source: 'holder.idle',
        message: `released ${this.args.sessionId} at Idle while the plane can still claim it: ${guard.reasons.join('; ')}`,
      })
    }
    await this.args.beforeRelease()
    if (guard.reasons.length > 0) await this.markSettled({ guard, threadId: args.threadId })
    await runtime.release()
    this.wasReleased = true
    this.finish(EHeldOutcome.Idle)
  }

  private async markSettled(args: { guard: IdleReleaseGuard; threadId: ThreadId }): Promise<void> {
    const record = this.args.record()
    if (record === undefined) return
    try {
      await record.append({
        threadId: args.threadId,
        runId: this.args.deps.ids.nextRunId(),
        drafts: [{ type: 'idle-released', inboxHead: args.guard.inboxHead }],
      })
    } catch (error) {
      this.args.deps.log?.warn({
        source: 'holder.idle',
        message: `recording the idle release of ${this.args.sessionId} failed`,
        ...logFieldsOf({ error }),
      })
    }
  }

  async handBack(args: { needsHolder: boolean }): Promise<void> {
    if (this.handedBack) return
    this.handedBack = true
    this.args.record()?.fence()
    try {
      const revoked = await this.args.deps.plane.revoke({
        sessionId: this.args.sessionId,
        epoch: this.epochOfLease,
        wantsHolder: args.needsHolder,
        resetRetry: true,
      })
      if (!args.needsHolder) {
        const epoch = revoked.ok ? revoked.lease.epoch : await this.freeEpoch()
        if (epoch !== undefined && (await this.needsHolder())) {
          await this.args.deps.plane.revoke({
            sessionId: this.args.sessionId,
            epoch,
            wantsHolder: true,
          })
        }
      }
    } catch (error) {
      this.args.deps.log?.warn({
        source: 'holder.drain',
        message: `handing the lease on ${this.args.sessionId} back failed`,
        ...logFieldsOf({ error }),
      })
    }
    this.finish(EHeldOutcome.Drained)
  }

  private async freeEpoch(): Promise<number | undefined> {
    const { lease } = await this.args.deps.plane.currentLease({ sessionId: this.args.sessionId })
    if (lease.holderHostId !== null || lease.wantsHolder) return undefined
    return lease.epoch
  }

  private needsHolder(): Promise<boolean> {
    return drainNeedsHolder({
      deps: this.args.deps,
      record: this.args.record(),
      turnRunning: this.args.turns.turnRunning,
    })
  }

  finish(kind: EHeldOutcome): void {
    if (this.kind !== undefined) return
    this.kind = kind
    this.args.reconciler()?.stop()
    this.drive?.()
  }
}
