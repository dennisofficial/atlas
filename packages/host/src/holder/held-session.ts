import { EToolEffect, isResumable, type Lease, type ThreadId } from '@dltech/atlas-core'
import { LoopTurnRunner, PauseSignal, settleCrashedCalls } from '@dltech/atlas-agent'
import { logFieldsOf } from '@dltech/atlas-observability'

import { statusFrame, type SessionRuntime } from './ports'
import { BranchObserver } from './branch-observer'
import { createLoopRunner } from './held-runner'
import { InboxIntake } from './inbox-intake'
import { idleReleaseDue, releaseIdleSession } from './held-idle'
import { consumeStops, interruptibleWait } from './held-wait'
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
  private intake: InboxIntake | undefined
  private branches: BranchObserver | undefined
  private renewal: LeaseRenewal | undefined
  private interruptWait: (() => void) | undefined
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

  beginDrain(): void {
    this.draining = true
    this.branches?.stop()
    this.pause.pause()
    this.record?.markDraining()
    this.interruptWait?.()
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
    const late = new Promise<'late'>((resolve) => {
      const timer = this.deps.timers.setTimeout(() => resolve('late'), remaining)
      void this.done?.then(
        () => this.deps.timers.clearTimeout(timer),
        () => this.deps.timers.clearTimeout(timer),
      )
    })
    const winner = await Promise.race([this.done.then(() => 'done' as const), late])
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
        retryUntil: () => this.drainDeadline ?? renewal.fenceDeadline(),
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
      const branches = new BranchObserver({
        record: {
          append: ({ threadId: to, runId, body }) =>
            record.append({ threadId: to, runId, drafts: [body] }),
          events: () => record.eventCache().all(),
        },
        remoteCalls: runtime.remoteCalls,
        threadId,
        repos: () => runtime.watchedRepos(),
        runId: () => deps.ids.nextRunId(),
        signal: this.lifetimeAbort.signal,
        ...(deps.log === undefined ? {} : { log: deps.log }),
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
      if (isResumable(events)) {
        await this.driveTurn({ runner, threadId, resume: true })
      }

      await this.pollLoop({ runner, threadId })
    } catch (error) {
      if (!(error instanceof LeaseLostError)) {
        this.deps.log?.error({
          source: 'holder.session',
          message: `session ${this.deps.sessionId} faulted`,
          ...logFieldsOf({ error }),
        })
      }
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
      intake: this.intake,
      pause: this.pause,
      resume: args.resume,
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

  private async pollLoop(args: { runner: LoopTurnRunner; threadId: ThreadId }): Promise<void> {
    const deps = this.deps
    while (!this.lifetimeAbort.signal.aborted) {
      if (this.draining) return
      await this.consumeStops()
      if (await this.checkIdle()) return
      if ((await this.pendingInput()) === 0) {
        await this.wait(deps.inboxPollMs)
        continue
      }
      this.lastActivityAt = deps.timers.now()
      await this.driveTurn({ runner: args.runner, threadId: args.threadId, resume: false })
    }
  }

  private pendingInput(): Promise<number> {
    return this.deps.plane
      .readInbox({ sessionId: this.deps.sessionId, afterId: 0, limit: 1 })
      .then((entries) => entries.length)
      .catch(() => 0)
  }

  private wait(ms: number): Promise<void> {
    return interruptibleWait({
      deps: this.deps,
      signal: this.lifetimeAbort.signal,
      ms,
      setInterrupter: (interrupter) => {
        this.interruptWait = interrupter
      },
    })
  }

  private drop(): void {
    if (this.lostOwnership) return
    this.lostOwnership = true
    this.branches?.stop()
    this.record?.fence()
    this.turns.abort()
    this.lifetimeAbort.abort()
    this.runtime?.remoteCalls.handoff()
    this.runtime?.remoteCalls.close()
  }

  private async checkIdle(): Promise<boolean> {
    const deps = this.deps
    if (this.runtime === undefined) return false
    const due = idleReleaseDue({
      deps,
      turnRunning: this.turns.turnRunning,
      lastActivityAt: this.lastActivityAt,
      runtime: this.runtime,
      released: this.released,
      pendingInput: (await this.pendingInput()) > 0,
    })
    if (!due) return false
    this.released = true
    await releaseIdleSession({ deps, runtime: this.runtime })
    const late = await this.pendingInput()
    this.drop()
    if (late > 0) {
      this.deps.onDrop?.()
      await deps.bus.wake(deps.sessionId).catch(() => undefined)
    }
    return true
  }

  private async teardown(): Promise<void> {
    const deps = this.deps
    this.renewal?.stop()
    this.branches?.stop()
    if (this.runtime === undefined) return
    if (this.draining) {
      await this.runtime.stop()
      if (!this.lostOwnership) {
        await deps.plane
          .revoke({ sessionId: deps.sessionId, wantsHolder: true, epoch: this.leaseEpoch })
          .catch(() => undefined)
        await deps.bus.wake(deps.sessionId).catch(() => undefined)
      }
      return
    }
    if (!this.released) this.runtime.remoteCalls.close()
  }
}
