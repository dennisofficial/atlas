import { EHeldAction, type Lease, type ThreadId } from '@dltech/atlas-core'
import { LoopTurnRunner, PauseSignal } from '@dltech/atlas-agent'

import { statusFrame, type SessionRuntime } from './ports'
import type { BranchObserver } from './branch-observer'
import {
  logDriveFault,
  logReconcileFault,
  settleAndCheckResume,
  startHeldTurn,
  wireHeldLoop,
} from './held-runner'
import { releaseIdleAndRewake, teardownHeldSession } from './held-idle'
import { HeldPrepare } from './held-prepare'
import { readHeldAction } from './held-snapshot'
import { IdleDeadline } from './idle-deadline'
import { consumeStops, raceDeadline } from './held-wait'
import { Reconciler } from './reconciler'
import type { SessionRecord } from './record/record-adapter'
import type { HeldSessionDeps } from './held-session-deps'
import { HeldTurns } from './held-turns'
import { TakeOver } from './held-takeover'

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
  private done: Promise<void> | undefined
  private lastActivityAt: number
  private runtime: SessionRuntime | undefined
  private record: SessionRecord | undefined
  private branches: BranchObserver | undefined
  private reconciler: Reconciler | undefined
  private finishDrive: (() => void) | undefined
  private readonly idle: IdleDeadline
  private leaseEpoch = 0
  private drainModelOnly = false
  private lostOwnership = false
  private released = false
  private failedToStart = false
  private ended = false
  private resumePending = false
  private takeOver: TakeOver | undefined

  constructor(deps: HeldSessionDeps) {
    this.deps = deps
    this.sessionId = deps.sessionId
    this.lastActivityAt = deps.timers.now()
    this.turns = new HeldTurns(deps)
    this.prepare = new HeldPrepare({
      deps,
      abandoned: () => this.draining || this.ended,
      onSettled: ({ failed }) => {
        this.lastActivityAt = deps.timers.now()
        if (failed) void this.releaseIdle((runtime) => runtime.stop())
        else this.reconciler?.request()
      },
    })
    this.idle = new IdleDeadline({
      timers: deps.timers,
      idleMinutes: deps.idleMinutes,
      onDue: () => this.reconciler?.request(),
    })
  }

  get startFailed(): boolean {
    return this.failedToStart
  }

  notifyWake(): void {
    if (this.draining || this.lostOwnership) return
    this.reconciler?.request()
  }

  beginDrain(): void {
    this.draining = true
    this.branches?.stop()
    this.pause.pause()
    this.record?.markDraining()
    this.reconciler?.request()
  }

  run(args: { lease: Lease; threadId: ThreadId; claimMs?: number }): Promise<void> {
    this.leaseEpoch = args.lease.epoch
    const done = this.drive(args)
    this.done = done
    return done
  }

  discard(): void {
    this.beginDrain()
    this.drop()
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

  private async drive(args: { lease: Lease; threadId: ThreadId; claimMs?: number }): Promise<void> {
    const { lease, threadId } = args
    const deps = this.deps
    deps.bus.live({ sessionId: deps.sessionId, frame: statusFrame({ state: 'starting' }) })
    try {
      this.takeOver = new TakeOver(deps, args.claimMs ?? 0)
      const { runtime, record } = await this.takeOver.open({
        threadId,
        epoch: lease.epoch,
        signal: this.lifetimeAbort.signal,
        drainDeadline: () => this.drainDeadline,
        onLeaseLost: () => this.drop(),
        onRuntime: (opened) => {
          this.runtime = opened
        },
      })
      this.record = record
      if (this.draining) record.markDraining()

      const { runner, branches } = wireHeldLoop({
        deps,
        runtime,
        record,
        turns: this.turns,
        threadId,
        signal: this.lifetimeAbort.signal,
        isModelOnlyDrain: () => this.drainModelOnly,
      })
      this.branches = branches
      this.resumePending = await settleAndCheckResume({ deps, runtime, record, threadId })

      const completion = new Promise<void>((resolve) => {
        this.finishDrive = resolve
      })
      if (!this.ended) {
        const reconciler = new Reconciler({
          timers: deps.timers,
          step: () => this.step({ runner, threadId }),
          onError: (error) => logReconcileFault({ deps, error }),
        })
        this.reconciler = reconciler
        reconciler.request()
        await completion
      }
    } catch (error) {
      logDriveFault({ deps: this.deps, error })
      if (!this.lostOwnership && !this.draining && this.reconciler === undefined) {
        this.failedToStart = true
      }
    } finally {
      await this.teardown()
    }
  }

  private async step(args: { runner: LoopTurnRunner; threadId: ThreadId }): Promise<void> {
    if (this.ended) return
    const deps = this.deps
    const turnRunning = this.turns.turnRunning
    if (this.draining) return turnRunning ? undefined : this.finish()
    const { entries, action, inboxHead } = await readHeldAction({
      deps,
      draining: this.draining,
      turnRunning,
      resumePending: this.resumePending,
      lastActivityAt: this.lastActivityAt,
      runtime: this.runtime,
      released: this.released,
      events: this.record?.eventCache().all() ?? [],
      preparing: this.prepare.running,
    })
    switch (action) {
      case EHeldAction.AbortTurn: {
        this.turns.abort('stop')
        return
      }
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
        await this.releaseIdle((runtime) => runtime.release())
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
        if (this.draining || this.lostOwnership) return
        void this.branches?.refresh().catch((error) => logDriveFault({ deps: this.deps, error }))
      },
      onFault: () => this.finish(),
      onSettled: () => this.reconciler?.request(),
    })
  }

  private async releaseIdle(end: (runtime: SessionRuntime) => Promise<void>): Promise<void> {
    if (this.runtime === undefined || this.released) return
    this.released = true
    const { runtime, record } = this
    await releaseIdleAndRewake({
      deps: this.deps,
      epoch: this.leaseEpoch,
      end: () => end(runtime),
      record,
      drop: () => this.drop(),
      finish: () => this.finish(),
    })
  }

  private drop(): void {
    if (this.lostOwnership) return
    this.lostOwnership = true
    this.branches?.stop()
    this.record?.fence()
    this.runtime?.remoteCalls.handoff()
    this.turns.abort()
    this.lifetimeAbort.abort()
    this.runtime?.remoteCalls.close()
    this.finish()
  }

  private finish(): void {
    if (this.ended) return
    this.ended = true
    this.idle.disarm()
    this.reconciler?.stop()
    this.finishDrive?.()
  }

  private async teardown(): Promise<void> {
    this.branches?.stop()
    await teardownHeldSession({
      deps: this.deps,
      runtime: this.runtime,
      record: this.record,
      turnRunning: this.turns.turnRunning,
      draining: this.draining,
      lostOwnership: this.lostOwnership,
      released: this.released,
      failedToStart: this.failedToStart,
      epoch: this.leaseEpoch,
    })
  }
}
