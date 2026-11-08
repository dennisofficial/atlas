import {
  crashLooped,
  EHeldAction,
  EHeldOutcome,
  type HeldOutcome,
  type Lease,
  type ThreadId,
} from '@dltech/atlas-core'
import { LoopTurnRunner, PauseSignal } from '@dltech/atlas-agent'

import type { SessionRuntime } from './ports'
import type { BranchObserver } from './branch-observer'
import {
  logDriveFault,
  logReconcileFault,
  settleAndCheckResume,
  startHeldTurn,
  wireHeldLoop,
} from './held-runner'
import { teardownHeld } from './held-teardown'
import { HeldPrepare } from './held-prepare'
import { readHeldAction } from './held-snapshot'
import { IdleDeadline } from './idle-deadline'
import { lostOutcome } from './lost-outcome'
import { consumeStops, raceDeadline } from './held-wait'
import { Reconciler } from './reconciler'
import type { SessionRecord } from './record/record-adapter'
import type { HeldSessionDeps } from './held-session-deps'
import { HeldTurns } from './held-turns'
import { TakeOver } from './held-takeover'
import { quarantineOutcome, startFailureOutcome } from './start-failure-record'

export type { HeldSessionDeps }

export class HeldSession {
  readonly sessionId: string
  private readonly deps: HeldSessionDeps
  private readonly lifetimeAbort = new AbortController()
  private readonly pause = new PauseSignal()
  private readonly turns: HeldTurns
  private readonly prepare: HeldPrepare
  private draining = false
  private drainDeadline: number | undefined
  private done: Promise<HeldOutcome> | undefined
  private lastActivityAt: number
  private runtime: SessionRuntime | undefined
  private record: SessionRecord | undefined
  private branches: BranchObserver | undefined
  private reconciler: Reconciler | undefined
  private finishDrive: (() => void) | undefined
  private readonly idle: IdleDeadline
  private leaseEpoch = 0
  private drainModelOnly = false
  private outcome: EHeldOutcome | undefined
  private released = false
  private resumePending = false
  private takeOver: TakeOver | undefined

  constructor(deps: HeldSessionDeps) {
    this.deps = deps
    this.sessionId = deps.sessionId
    this.lastActivityAt = deps.timers.now()
    this.turns = new HeldTurns(deps)
    this.prepare = new HeldPrepare({
      deps,
      abandoned: () => this.draining || this.outcome !== undefined,
      onSettled: ({ failed }) => {
        this.lastActivityAt = deps.timers.now()
        if (failed) this.finish(EHeldOutcome.Idle)
        else this.reconciler?.request()
      },
    })
    this.idle = new IdleDeadline({
      timers: deps.timers,
      idleMinutes: deps.idleMinutes,
      onDue: () => this.reconciler?.request(),
    })
  }

  notifyWake(): void {
    if (this.draining || this.outcome !== undefined) return
    this.reconciler?.request()
  }

  beginDrain(): void {
    this.draining = true
    this.branches?.stop()
    this.pause.pause()
    this.record?.markDraining()
    this.reconciler?.request()
  }

  run(args: { lease: Lease; threadId: ThreadId; claimMs?: number }): Promise<HeldOutcome> {
    this.leaseEpoch = args.lease.epoch
    const done = this.drive(args)
    this.done = done
    return done
  }

  discard(): void {
    this.beginDrain()
    this.loseLease()
  }

  async handoff(args: { deadline: number }): Promise<void> {
    this.beginDrain()
    this.drainDeadline = args.deadline
    if (this.done === undefined) return
    const remaining = Math.max(0, args.deadline - this.deps.timers.now())
    const winner = await raceDeadline({ deps: this.deps, done: this.done, deadlineMs: remaining })
    if (winner === 'late') {
      this.drainModelOnly = true
      this.runtime?.remoteCalls.handoff()
      this.turns.abort('handoff')
    }
    await this.done
  }

  private async drive(args: {
    lease: Lease
    threadId: ThreadId
    claimMs?: number
  }): Promise<HeldOutcome> {
    try {
      await this.scope(args)
    } catch (error) {
      logDriveFault({ deps: this.deps, error })
      if (this.outcome === undefined) await this.settleFault({ ...args, error })
    }
    this.branches?.stop()
    return teardownHeld({
      deps: this.deps,
      runtime: this.runtime,
      record: this.record,
      turnRunning: this.turns.turnRunning,
      kind: this.outcome ?? EHeldOutcome.Faulted,
      released: this.released,
    })
  }

  private async settleFault(args: {
    error: unknown
    lease: Lease
    threadId: ThreadId
  }): Promise<void> {
    if (this.reconciler !== undefined || this.draining) return this.finish(EHeldOutcome.Faulted)
    this.finish(await startFailureOutcome({ deps: this.deps, ...args }))
  }

  private async scope(args: { lease: Lease; threadId: ThreadId; claimMs?: number }): Promise<void> {
    const { lease, threadId } = args
    const { deps } = this
    if (crashLooped(lease)) return this.finish(await quarantineOutcome({ deps, lease, threadId }))
    this.takeOver = new TakeOver(deps, args.claimMs ?? 0)
    const { runtime, record } = await this.takeOver.open({
      threadId,
      epoch: lease.epoch,
      signal: this.lifetimeAbort.signal,
      drainDeadline: () => this.drainDeadline,
      onLeaseLost: (error) => this.loseLease(lostOutcome(error)),
      onRuntime: (opened) => {
        this.runtime = opened
      },
    })
    this.record = record
    if (this.lifetimeAbort.signal.aborted) return record.fence()
    if (this.draining) record.markDraining()
    const { runner, branches, recoverCommands } = wireHeldLoop({
      deps,
      runtime,
      record,
      turns: this.turns,
      threadId,
      signal: this.lifetimeAbort.signal,
      epoch: lease.epoch,
      isModelOnlyDrain: () => this.drainModelOnly,
    })
    this.branches = branches
    this.resumePending = await settleAndCheckResume({ deps, runtime, record, threadId })
    await recoverCommands()
    const completion = new Promise<void>((resolve) => (this.finishDrive = resolve))
    if (this.lifetimeAbort.signal.aborted || this.outcome !== undefined) return
    const reconciler = new Reconciler({
      timers: deps.timers,
      step: () => this.step({ runner, threadId }),
      onError: (error) => logReconcileFault({ deps, error }),
    })
    this.reconciler = reconciler
    reconciler.request()
    await completion
  }

  private async step(args: { runner: LoopTurnRunner; threadId: ThreadId }): Promise<void> {
    if (this.outcome !== undefined) return
    const deps = this.deps
    const turnRunning = this.turns.turnRunning
    if (this.draining) return turnRunning ? undefined : this.finish(EHeldOutcome.Drained)
    const { entries, action, inboxHead, shellsRunning } = await readHeldAction({
      deps,
      draining: this.draining,
      turnRunning,
      resumePending: this.resumePending,
      lastActivityAt: this.lastActivityAt,
      runtime: this.runtime,
      workspace: this.record?.eventCache().bookkeeping().workspace(),
      preparing: this.prepare.running,
    })
    if (shellsRunning) this.lastActivityAt = deps.timers.now()
    switch (action) {
      case EHeldAction.AbortTurn:
        return this.turns.abort('stop')
      case EHeldAction.ConsumeStop: {
        this.resumePending = false
        await consumeStops({
          deps,
          record: this.record,
          entries,
          onActivity: () => {
            this.lastActivityAt = deps.timers.now()
          },
        })
        this.reconciler?.request()
        return
      }
      case EHeldAction.Prepare: {
        const { runtime, record } = this
        if (runtime === undefined || record === undefined) return
        this.takeOver?.firstStep()
        this.prepare.start({ runtime, record, threadId: args.threadId, inboxHead })
        return
      }
      case EHeldAction.StartTurn: {
        this.takeOver?.firstStep()
        const resume = this.resumePending
        this.resumePending = false
        this.lastActivityAt = deps.timers.now()
        this.startTurn({ runner: args.runner, threadId: args.threadId, resume })
        return
      }
      case EHeldAction.Release: {
        await this.releaseIdle()
        return
      }
      case EHeldAction.Wait: {
        if (turnRunning || this.prepare.running) return
        this.idle.arm({ lastActivityAt: this.lastActivityAt })
      }
    }
  }

  private startTurn(args: { runner: LoopTurnRunner; threadId: ThreadId; resume: boolean }): void {
    this.idle.disarm()
    startHeldTurn({
      deps: this.deps,
      turns: this.turns,
      pause: this.pause,
      runner: args.runner,
      threadId: args.threadId,
      resume: args.resume,
      onActivity: () => {
        this.lastActivityAt = this.deps.timers.now()
      },
      refreshBranches: () => {
        if (this.draining || this.outcome !== undefined) return
        void this.branches?.refresh().catch((error) => logDriveFault({ deps: this.deps, error }))
      },
      onFault: () => this.finish(EHeldOutcome.Faulted),
      onSettled: () => this.reconciler?.request(),
    })
  }

  loseLease(kind: EHeldOutcome = EHeldOutcome.Fenced): void {
    if (this.lifetimeAbort.signal.aborted) return
    this.branches?.stop()
    this.record?.fence()
    this.runtime?.remoteCalls.handoff()
    this.turns.abort()
    this.lifetimeAbort.abort()
    this.runtime?.remoteCalls.close()
    this.finish(kind)
  }

  private async releaseIdle(): Promise<void> {
    const { runtime } = this
    if (runtime === undefined) return
    const current = await this.deps.plane.currentLease({ sessionId: this.sessionId })
    if (current.lease.epoch !== this.leaseEpoch) return this.loseLease()
    await runtime.release()
    this.released = true
    this.finish(EHeldOutcome.Idle)
  }

  private finish(kind: EHeldOutcome): void {
    if (this.outcome !== undefined) return
    this.outcome = kind
    this.idle.disarm()
    this.reconciler?.stop()
    this.finishDrive?.()
  }
}
