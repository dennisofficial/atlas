import {
  EToolEffect,
  isResumable,
  serveIdleDue,
  type Lease,
  type ThreadId,
} from '@dltech/atlas-core'
import {
  HookChain,
  HookedToolDispatcher,
  LoopTurnRunner,
  PauseSignal,
  settleCrashedCalls,
} from '@dltech/atlas-agent'
import { logFieldsOf } from '@dltech/atlas-observability'

import { ScopedToolDispatcher } from '../calls/call-scope'
import { statusFrame, type SessionRuntime } from './ports'
import { InboxIntake } from './inbox-intake'
import { LeaseLostError, SessionRecord } from './record/record-adapter'
import { V2OnceLedger } from './record/v2-once-ledger'
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

  async handoff(args: { deadline: number }): Promise<void> {
    this.beginDrain()
    this.drainDeadline = args.deadline
    if (this.done === undefined) return
    const remaining = Math.max(0, args.deadline - this.deps.timers.now())
    const late = new Promise<'late'>((resolve) => {
      this.deps.timers.setTimeout(() => resolve('late'), remaining)
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
      const runner = new LoopTurnRunner({
        record,
        modelContext: record,
        model: runtime.model,
        ids: deps.ids,
        assembly: runtime.assembly,
        tools: () => runtime.tools.declarations(),
        dispatch: new ScopedToolDispatcher(
          new HookedToolDispatcher({ registry: runtime.tools, hooks: new HookChain({}) }),
        ),
        intake,
        output: this.turns.liveOutput(),
        detachTool: (tool) => this.drainModelOnly && runtime.daemonTools.has(tool),
        launchDirectory: runtime.launchDirectory,
        normalizeFailure: runtime.normalizeFailure,
        onceLedger: new V2OnceLedger({
          cache: record.eventCache(),
          record,
          threadId,
          runId: () => deps.ids.nextRunId(),
        }),
      })

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
  }

  private async consumeStops(): Promise<void> {
    if (this.record === undefined || this.intake === undefined) return
    for (;;) {
      const inboxId = this.intake.takeStop()
      if (inboxId === undefined) return
      this.lastActivityAt = this.deps.timers.now()
      await this.record.append({
        threadId: this.record.threadId,
        runId: this.deps.ids.nextRunId(),
        drafts: [{ type: 'input-consumed', inboxId }],
      })
      this.intake.stopConsumed(inboxId)
    }
  }

  private async pollLoop(args: { runner: LoopTurnRunner; threadId: ThreadId }): Promise<void> {
    const deps = this.deps
    while (!this.lifetimeAbort.signal.aborted) {
      if (this.draining) return
      await this.consumeStops()
      if (await this.checkIdle()) return
      const pending = await deps.plane.readInbox({
        sessionId: deps.sessionId,
        afterId: 0,
        limit: 1,
      })
      if (pending.length === 0) {
        await this.wait(deps.inboxPollMs)
        continue
      }
      this.lastActivityAt = deps.timers.now()
      await this.driveTurn({ runner: args.runner, threadId: args.threadId, resume: false })
    }
  }

  private wait(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const finish = (): void => {
        this.interruptWait = undefined
        resolve()
      }
      const timer = this.deps.timers.setTimeout(finish, ms)
      this.interruptWait = () => {
        this.deps.timers.clearTimeout(timer)
        finish()
      }
      const onAbort = (): void => {
        this.deps.timers.clearTimeout(timer)
        finish()
      }
      this.lifetimeAbort.signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  private drop(): void {
    this.lostOwnership = true
    this.record?.fence()
    this.turns.abort()
    this.lifetimeAbort.abort()
    this.runtime?.remoteCalls.handoff()
    this.runtime?.remoteCalls.close()
  }

  private async checkIdle(): Promise<boolean> {
    const deps = this.deps
    const due =
      !this.turns.turnRunning &&
      !this.released &&
      this.runtime !== undefined &&
      serveIdleDue({
        lastActivityAt: this.lastActivityAt,
        turnRunning: this.turns.turnRunning,
        childrenSettling: false,
        runningShells: 0,
        runningServices: 0,
        idleMinutes: deps.idleMinutes,
        now: deps.timers.now(),
      })
    if (!due) return false
    this.released = true
    try {
      await this.runtime?.release()
      await deps.plane.revoke({ sessionId: deps.sessionId, wantsHolder: false })
    } catch (error) {
      deps.log?.error({
        source: 'holder.idle',
        message: `idle release of ${deps.sessionId} failed`,
        ...logFieldsOf({ error }),
      })
    }
    this.drop()
    return true
  }

  private async teardown(): Promise<void> {
    const deps = this.deps
    this.renewal?.stop()
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
