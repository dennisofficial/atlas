import { EToolEffect, isResumable, type Lease, type ThreadId } from '@dltech/atlas-core'
import { LoopTurnRunner, PauseSignal, settleCrashedCalls } from '@dltech/atlas-agent'

import { statusFrame, type SessionRuntime } from './ports'
import type { BranchObserver } from './branch-observer'
import { createBranchObserver, createLoopRunner, logDriveFault } from './held-runner'
import { InboxIntake } from './inbox-intake'
import {
  idleDueNow,
  idleWaitMs,
  pendingInputCount,
  releaseIdleAndRewake,
  teardownHeldSession,
} from './held-idle'
import {
  consumeStops,
  pollStopsWithRetry,
  raceDeadline,
  readRetryMs,
  waitMs,
  WakeSignal,
} from './held-wait'
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
  private intake: InboxIntake | undefined
  private branches: BranchObserver | undefined
  private renewal: LeaseRenewal | undefined
  private readonly wake = new WakeSignal()
  private leaseEpoch = 0
  private drainModelOnly = false
  private lostOwnership = false
  private released = false

  get isSelfFenced(): boolean {
    return this.renewal?.isSelfFenced ?? false
  }

  constructor(deps: HeldSessionDeps) {
    this.deps = deps
    this.sessionId = deps.sessionId
    this.lastActivityAt = deps.timers.now()
    this.turns = new HeldTurns(deps)
  }

  notifyWake(): void {
    if (this.draining || this.lostOwnership) return
    this.wake.notify()
    void this.retryStops()
  }

  beginDrain(): void {
    this.draining = true
    this.branches?.stop()
    this.pause.pause()
    this.record?.markDraining()
    this.wake.notify()
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

      const intake = new InboxIntake({
        plane: deps.plane,
        sessionId: deps.sessionId,
        record,
        threadId,
        runId: () => deps.ids.nextRunId(),
        onStop: () => this.turns.abort('stop'),
        ...(deps.log === undefined ? {} : { log: deps.log }),
      })
      this.intake = intake
      const runner = createLoopRunner({
        deps,
        runtime,
        record,
        intake,
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
      await this.retryStops()
      if (isResumable(events)) {
        await this.driveTurn({ runner, threadId, resume: true })
      }

      await this.pollLoop({ runner, threadId })
    } catch (error) {
      logDriveFault({ deps: this.deps, error })
    } finally {
      await this.teardown()
    }
  }

  private async driveTurn(args: {
    runner: LoopTurnRunner
    threadId: ThreadId
    resume: boolean
  }): Promise<void> {
    if (this.intake === undefined) return
    await this.turns.drive({
      runner: args.runner,
      threadId: args.threadId,
      pause: this.pause,
      resume: args.resume,
      hasPendingStop: () => this.intake?.hasPendingStop() ?? false,
      onActivity: () => {
        this.lastActivityAt = this.deps.timers.now()
      },
    })
    await this.consumeStops()
    if (!this.draining && !this.lostOwnership) await this.branches?.refresh()
  }

  private consumeStops(): Promise<void> {
    return consumeStops({
      deps: this.deps,
      record: this.record,
      intake: this.intake,
      onActivity: () => {
        this.lastActivityAt = this.deps.timers.now()
      },
    })
  }

  private retryStops(): Promise<void> {
    return pollStopsWithRetry({
      deps: this.deps,
      signal: this.lifetimeAbort.signal,
      intake: () => this.intake,
      active: () => !this.draining && !this.lostOwnership,
      onStopSeen: () => this.wake.notify(),
    })
  }

  private async pollLoop(args: { runner: LoopTurnRunner; threadId: ThreadId }): Promise<void> {
    const deps = this.deps
    let readFailures = 0
    while (!this.lifetimeAbort.signal.aborted) {
      if (this.draining) return
      this.wake.clear()
      let pending: number
      try {
        await this.retryStops()
        await this.consumeStops()
        if (await this.checkIdle()) return
        pending = await pendingInputCount(deps)
        readFailures = 0
      } catch {
        readFailures += 1
        await waitMs({
          deps,
          signal: this.lifetimeAbort.signal,
          ms: readRetryMs({ failures: readFailures }),
        })
        continue
      }
      if (pending === 0) {
        await this.wake.wait({
          deps,
          signal: this.lifetimeAbort.signal,
          ms: idleWaitMs({ deps, lastActivityAt: this.lastActivityAt }),
        })
        continue
      }
      this.lastActivityAt = deps.timers.now()
      await this.driveTurn({ runner: args.runner, threadId: args.threadId, resume: false })
    }
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
  }

  private async checkIdle(): Promise<boolean> {
    const deps = this.deps
    const due = await idleDueNow({
      deps,
      runtime: this.runtime,
      turnRunning: this.turns.turnRunning,
      lastActivityAt: this.lastActivityAt,
      released: this.released,
      pendingInput: () => pendingInputCount(deps),
    })
    if (!due || this.runtime === undefined) return false
    this.released = true
    await releaseIdleAndRewake({ deps, runtime: this.runtime, drop: () => this.drop() })
    return true
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
