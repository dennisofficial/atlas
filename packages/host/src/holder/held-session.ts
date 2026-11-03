import {
  EToolEffect,
  isResumable,
  serveIdleDue,
  type IdPort,
  type Lease,
  type ThreadId,
} from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'
import {
  ETurnStatus,
  HookChain,
  HookedToolDispatcher,
  LoopTurnRunner,
  PauseSignal,
  settleCrashedCalls,
  type AgentOutput,
} from '@dltech/atlas-agent'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import { ScopedToolDispatcher } from '../calls/call-scope'
import type { HostBus, HostTimers, SessionRuntime, SessionRuntimeFactory } from './ports'
import { statusFrame } from './ports'
import { InboxIntake } from './inbox-intake'
import { LeaseLostError, SessionRecord } from './record/record-adapter'
import { V2OnceLedger } from './record/v2-once-ledger'

export type HeldSessionDeps = {
  sessionId: string
  holderId: string
  plane: ControlPlane
  bus: HostBus
  timers: HostTimers
  ids: IdPort
  ttlMs: number
  renewEveryMs: number
  fenceMarginMs: number
  inboxPollMs: number
  idleMinutes: number
  runtimeFor: SessionRuntimeFactory
  log?: LogPort | undefined
}

const TURN_EXITED = new Set<ETurnStatus>([ETurnStatus.Failed, ETurnStatus.Interrupted])

export class HeldSession {
  readonly sessionId: string
  private readonly deps: HeldSessionDeps
  private readonly lifetimeAbort = new AbortController()
  private readonly pause = new PauseSignal()
  private turnAbort: AbortController | undefined
  private draining = false
  private drainDeadline: number | undefined
  private done: Promise<void> | undefined
  private renewTimer: unknown
  private lastRenewOk: number
  private lastActivityAt: number
  private turnRunning = false
  private runtime: SessionRuntime | undefined
  private record: SessionRecord | undefined
  private intake: InboxIntake | undefined
  private inboxTimer: unknown
  private interruptWait: (() => void) | undefined
  private released = false
  private stopping = false
  private dropped = false
  private selfFenced = false

  get isSelfFenced(): boolean {
    return this.selfFenced
  }

  constructor(deps: HeldSessionDeps) {
    this.deps = deps
    this.sessionId = deps.sessionId
    this.lastRenewOk = deps.timers.now()
    this.lastActivityAt = deps.timers.now()
  }

  beginDrain(): void {
    this.draining = true
    this.pause.pause()
    this.record?.markDraining()
    this.interruptWait?.()
  }

  run(args: { lease: Lease; threadId: ThreadId }): Promise<void> {
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
    if (winner === 'late') this.turnAbort?.abort('handoff')
    await this.done
  }

  private async drive(args: { lease: Lease; threadId: ThreadId }): Promise<void> {
    const { lease, threadId } = args
    const deps = this.deps
    deps.bus.live({ sessionId: deps.sessionId, frame: statusFrame({ state: 'starting' }) })
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
        retryUntil: () => this.drainDeadline ?? deps.timers.now() + deps.ttlMs - deps.fenceMarginMs,
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
        onStop: () => this.turnAbort?.abort('stop'),
        ...(deps.log === undefined ? {} : { log: deps.log }),
      })
      this.intake = intake
      const onceLedger = new V2OnceLedger({
        cache: record.eventCache(),
        record,
        threadId,
        runId: () => deps.ids.nextRunId(),
      })
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
        output: this.liveOutput(),
        launchDirectory: runtime.launchDirectory,
        normalizeFailure: runtime.normalizeFailure,
        onceLedger,
      })

      await settleCrashedCalls({
        record,
        ids: deps.ids,
        threadId,
        effectOf: (name) =>
          runtime.daemonTools.has(name) ? EToolEffect.Read : runtime.effectOf(name),
      })

      this.scheduleRenew({ epoch: lease.epoch })

      const events = await record.ownEvents({ threadId })
      if (isResumable(events)) {
        await this.driveTurn({ runner, threadId, resume: true })
      }

      await this.pollLoop({ runner, threadId, intake })
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

  private async pollLoop(args: {
    runner: LoopTurnRunner
    threadId: ThreadId
    intake: InboxIntake
  }): Promise<void> {
    const deps = this.deps
    while (!this.lifetimeAbort.signal.aborted) {
      if (this.draining) return
      if (this.stopping) {
        this.stopping = false
        this.lastActivityAt = deps.timers.now()
        await this.driveTurn({ runner: args.runner, threadId: args.threadId, resume: false })
        continue
      }
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

  private scheduleInboxPoll(): void {
    this.inboxTimer = this.deps.timers.setTimeout(() => {
      void this.intake?.pollStops().finally(() => {
        if (this.turnRunning) this.scheduleInboxPoll()
      })
    }, this.deps.inboxPollMs)
  }

  private async driveTurn(args: {
    runner: LoopTurnRunner
    threadId: ThreadId
    resume: boolean
  }): Promise<void> {
    const deps = this.deps
    this.turnAbort = new AbortController()
    this.turnRunning = true
    this.scheduleInboxPoll()
    deps.bus.live({ sessionId: deps.sessionId, frame: statusFrame({ state: 'thinking' }) })
    try {
      const outcome = args.resume
        ? await args.runner.resume({
            threadId: args.threadId,
            signal: this.turnAbort.signal,
            pause: this.pause,
          })
        : await args.runner.runTurn({
            threadId: args.threadId,
            signal: this.turnAbort.signal,
            pause: this.pause,
          })
      if (TURN_EXITED.has(outcome.status as ETurnStatus)) {
        this.lastActivityAt = deps.timers.now()
      }
    } finally {
      if (this.inboxTimer !== undefined) deps.timers.clearTimeout(this.inboxTimer)
      this.turnRunning = false
      this.turnAbort = undefined
      deps.bus.live({ sessionId: deps.sessionId, frame: statusFrame({ state: 'idle' }) })
      this.lastActivityAt = deps.timers.now()
    }
  }

  private liveOutput(): AgentOutput {
    const deps = this.deps
    return {
      emit: (event) => {
        if (event.type === 'tool-output') {
          deps.bus.live({
            sessionId: deps.sessionId,
            frame: {
              type: 'tool-output',
              callId: event.output.callId,
              text: event.output.text,
            },
          })
          return
        }
        if (event.type === 'retrying') {
          deps.bus.live({
            sessionId: deps.sessionId,
            frame: {
              type: 'retrying',
              attempt: event.attempt,
              maxAttempts: event.maxAttempts,
              reason: String(event.reason),
              delayMs: event.delayMs,
            },
          })
        }
      },
    }
  }

  private drop(): void {
    this.dropped = true
    this.turnAbort?.abort()
    this.lifetimeAbort.abort()
    this.runtime?.remoteCalls.close()
  }

  private scheduleRenew(args: { epoch: number }): void {
    this.renewTimer = this.deps.timers.setTimeout(() => {
      void this.renew(args.epoch)
    }, this.deps.renewEveryMs)
  }

  private async renew(epoch: number): Promise<void> {
    const deps = this.deps
    try {
      const result = await deps.plane.renew({
        sessionId: deps.sessionId,
        holderId: deps.holderId,
        epoch,
      })
      if (result.ok) {
        this.lastRenewOk = deps.timers.now()
      } else {
        this.drop()
        return
      }
    } catch (error) {
      deps.log?.warn({
        source: 'holder.renew',
        message: `renewing ${deps.sessionId} failed`,
        ...logFieldsOf({ error }),
      })
    }
    const silentMs = deps.timers.now() - this.lastRenewOk
    if (silentMs >= deps.ttlMs - deps.fenceMarginMs) {
      deps.log?.error({
        source: 'holder.fence',
        message: `session ${deps.sessionId} self-fenced after ${silentMs}ms without a renew`,
      })
      this.selfFenced = true
      this.drop()
      return
    }
    if (!this.lifetimeAbort.signal.aborted) this.scheduleRenew({ epoch })
  }

  private async checkIdle(): Promise<boolean> {
    const deps = this.deps
    const now = deps.timers.now()
    const due =
      !this.turnRunning &&
      !this.released &&
      this.runtime !== undefined &&
      serveIdleDue({
        lastActivityAt: this.lastActivityAt,
        turnRunning: this.turnRunning,
        childrenSettling: false,
        runningShells: 0,
        runningServices: 0,
        idleMinutes: deps.idleMinutes,
        now,
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
    if (this.renewTimer !== undefined) deps.timers.clearTimeout(this.renewTimer)
    if (this.runtime === undefined) return
    if (this.draining) {
      await this.runtime.stop()
      await deps.plane
        .revoke({ sessionId: deps.sessionId, wantsHolder: true })
        .catch(() => undefined)
      await deps.bus.wake(deps.sessionId).catch(() => undefined)
      return
    }
    if (!this.released) this.runtime.remoteCalls.close()
  }
}
