import {
  EHeldAction,
  EToolEffect,
  isResumable,
  type Lease,
  type ThreadId,
} from '@dltech/atlas-core'
import { LoopTurnRunner, PauseSignal, settleCrashedCalls } from '@dltech/atlas-agent'

import { statusFrame, type SessionRuntime } from './ports'
import type { BranchObserver } from './branch-observer'
import {
  createBranchObserver,
  createLoopRunner,
  logDriveFault,
  logReconcileFault,
  startHeldTurn,
} from './held-runner'
import { releaseIdleAndRewake, teardownHeldSession } from './held-idle'
import { readHeldAction } from './held-snapshot'
import { IdleDeadline } from './idle-deadline'
import { consumeStops, raceDeadline } from './held-wait'
import { Reconciler } from './reconciler'
import { SessionRecord } from './record/record-adapter'
import type { HeldSessionDeps } from './held-session-deps'

export type { HeldSessionDeps }
import { HeldTurns } from './held-turns'
import { LeaseRenewal } from './lease-renewal'

export class HeldSession {
  readonly sessionId: string
  private readonly deps: HeldSessionDeps
  private readonly lifetimeAbort = new AbortController()
  private readonly pause = new PauseSignal()
  private readonly turns: HeldTurns
  private draining = false
  private drainDeadline: number | undefined
  private done: Promise<void> | undefined
  private lastActivityAt: number
  private runtime: SessionRuntime | undefined
  private record: SessionRecord | undefined
  private branches: BranchObserver | undefined
  private renewal: LeaseRenewal | undefined
  private reconciler: Reconciler | undefined
  private finishDrive: (() => void) | undefined
  private readonly idle: IdleDeadline
  private leaseEpoch = 0
  private drainModelOnly = false
  private lostOwnership = false
  private released = false
  private ended = false
  private resumePending = false

  constructor(deps: HeldSessionDeps) {
    this.deps = deps
    this.sessionId = deps.sessionId
    this.lastActivityAt = deps.timers.now()
    this.turns = new HeldTurns(deps)
    this.idle = new IdleDeadline({
      timers: deps.timers,
      idleMinutes: deps.idleMinutes,
      onDue: () => this.reconciler?.request(),
    })
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

  run(args: { lease: Lease; threadId: ThreadId }): Promise<void> {
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

  private async drive(args: { lease: Lease; threadId: ThreadId }): Promise<void> {
    const { lease, threadId } = args
    const deps = this.deps
    deps.bus.live({ sessionId: deps.sessionId, frame: statusFrame({ state: 'starting' }) })
    const renewal = new LeaseRenewal(deps, { epoch: lease.epoch, onLost: () => this.drop() })
    this.renewal = renewal
    renewal.schedule()
    try {
      const runtime = await deps.runtimeFor({
        sessionId: deps.sessionId,
        threadId,
        epoch: lease.epoch,
        signal: this.lifetimeAbort.signal,
      })
      this.runtime = runtime
      const record = await SessionRecord.open({
        plane: deps.plane,
        threadId,
        epoch: lease.epoch,
        timers: deps.timers,
        remoteCalls: runtime.remoteCalls,
        daemonTools: runtime.daemonTools,
        retryUntil: () => renewal.appendDeadline(this.drainDeadline),
        nowIso: () => new Date(deps.timers.now()).toISOString(),
        onLeaseLost: () => this.drop(),
        ...(deps.log === undefined ? {} : { log: deps.log }),
      })
      this.record = record
      if (this.draining) record.markDraining()

      const runner = createLoopRunner({
        deps,
        runtime,
        record,
        turns: this.turns,
        threadId,
        isModelOnlyDrain: () => this.drainModelOnly,
      })
      const branches = createBranchObserver({
        deps,
        record,
        runtime,
        threadId,
        signal: this.lifetimeAbort.signal,
      })
      this.branches = branches
      branches.start()

      await settleCrashedCalls({
        record,
        ids: deps.ids,
        threadId,
        effectOf: (name) =>
          runtime.daemonTools.has(name) ? EToolEffect.Read : runtime.effectOf(name),
      })

      const events = await record.ownEvents({ threadId })
      this.resumePending = isResumable(events)

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
    } finally {
      await this.teardown()
    }
  }

  private async step(args: { runner: LoopTurnRunner; threadId: ThreadId }): Promise<void> {
    if (this.ended) return
    const deps = this.deps
    const turnRunning = this.turns.turnRunning
    if (this.draining) {
      if (!turnRunning) this.finish()
      return
    }
    const { entries, action } = await readHeldAction({
      deps,
      draining: this.draining,
      turnRunning,
      resumePending: this.resumePending,
      lastActivityAt: this.lastActivityAt,
      runtime: this.runtime,
      released: this.released,
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
      case EHeldAction.StartTurn: {
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
        if (turnRunning) return
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

  private async releaseIdle(): Promise<void> {
    if (this.runtime === undefined || this.released) return
    this.released = true
    const drop = (): void => this.drop()
    const finish = (): void => this.finish()
    await releaseIdleAndRewake({ deps: this.deps, runtime: this.runtime, drop, finish })
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
    this.renewal?.stop()
    this.branches?.stop()
    await teardownHeldSession({
      deps: this.deps,
      runtime: this.runtime,
      draining: this.draining,
      lostOwnership: this.lostOwnership,
      released: this.released,
      epoch: this.leaseEpoch,
    })
  }
}
