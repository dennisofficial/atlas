import {
  decideHeldAction,
  EHeldAction,
  EToolEffect,
  isResumable,
  type Lease,
  type ThreadId,
} from '@dltech/atlas-core'
import { LoopTurnRunner, PauseSignal, settleCrashedCalls } from '@dltech/atlas-agent'
import { logFieldsOf } from '@dltech/atlas-observability'

import { statusFrame, type SessionRuntime } from './ports'
import type { BranchObserver } from './branch-observer'
import { createBranchObserver, createLoopRunner, logDriveFault } from './held-runner'
import { InboxIntake, INBOX_KIND_STOP } from './inbox-intake'
import { idleReleaseDue, releaseIdleAndRewake, teardownHeldSession } from './held-idle'
import { consumeStops, raceDeadline } from './held-wait'
import { Reconciler } from './reconciler'
import { LeaseLostError, SessionRecord } from './record/record-adapter'
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
  private idleTimer: unknown
  private leaseEpoch = 0
  private drainModelOnly = false
  private lostOwnership = false
  private released = false
  private ended = false
  private resumePending = false

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

      const intake = new InboxIntake({
        plane: deps.plane,
        sessionId: deps.sessionId,
        record,
        threadId,
        runId: () => deps.ids.nextRunId(),
        ...(deps.log === undefined ? {} : { log: deps.log }),
      })
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
      this.resumePending = isResumable(events)

      const completion = new Promise<void>((resolve) => {
        this.finishDrive = resolve
      })
      if (!this.ended) {
        const reconciler = new Reconciler({
          timers: deps.timers,
          step: () => this.step({ runner, threadId }),
          onError: (error) => {
            if (error instanceof LeaseLostError) return
            deps.log?.error({
              source: 'holder.session',
              message: `reconciling ${deps.sessionId} failed`,
              ...logFieldsOf({ error }),
            })
          },
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
    const entries = await deps.plane.readInbox({
      sessionId: deps.sessionId,
      afterId: 0,
      limit: 100,
    })
    const stopPending = entries.some((entry) => entry.kind === INBOX_KIND_STOP)
    const messagePending = entries.some((entry) => entry.kind !== INBOX_KIND_STOP)
    const turnRunning = this.turns.turnRunning
    const action = decideHeldAction({
      draining: this.draining,
      turn: turnRunning ? 'running' : 'idle',
      stopPending,
      messagePending: messagePending || this.resumePending,
      idleDue: idleReleaseDue({
        deps,
        turnRunning,
        lastActivityAt: this.lastActivityAt,
        runtime: this.runtime,
        released: this.released,
        pendingInput: messagePending,
      }),
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
        this.armIdleDeadline()
        if (this.draining && !turnRunning) this.finish()
      }
    }
  }

  private startTurn(args: { runner: LoopTurnRunner; threadId: ThreadId; resume: boolean }): void {
    this.disarmIdleDeadline()
    const turn = this.turns.drive({
      runner: args.runner,
      threadId: args.threadId,
      pause: this.pause,
      resume: args.resume,
      onActivity: () => {
        this.lastActivityAt = this.deps.timers.now()
      },
    })
    void turn
      .then(async () => {
        if (!this.draining && !this.lostOwnership) await this.branches?.refresh()
      })
      .catch((error) => {
        logDriveFault({ deps: this.deps, error })
        this.finish()
      })
      .finally(() => {
        this.reconciler?.request()
      })
  }

  private armIdleDeadline(): void {
    if (this.turns.turnRunning || this.draining || this.ended) return
    this.disarmIdleDeadline()
    const deadline = this.lastActivityAt + this.deps.idleMinutes * 60_000
    const ms = Math.max(1, deadline - this.deps.timers.now())
    this.idleTimer = this.deps.timers.setTimeout(() => {
      this.idleTimer = undefined
      this.reconciler?.request()
    }, ms)
  }

  private disarmIdleDeadline(): void {
    if (this.idleTimer === undefined) return
    this.deps.timers.clearTimeout(this.idleTimer)
    this.idleTimer = undefined
  }

  private async releaseIdle(): Promise<void> {
    if (this.runtime === undefined || this.released) return
    this.released = true
    await releaseIdleAndRewake({ deps: this.deps, runtime: this.runtime, drop: () => this.drop() })
    this.finish()
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
    this.disarmIdleDeadline()
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
