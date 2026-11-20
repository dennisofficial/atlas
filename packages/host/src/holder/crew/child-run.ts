import {
  EAgentStatus,
  EKilledBy,
  EReportKind,
  finishedTurnOf,
  type EventBody,
  isResumableOf,
  saidBody,
  type ThreadId,
} from '@dltech/atlas-core'
import { PauseSignal, type LoopTurnRunner, type TurnOutcome } from '@dltech/atlas-agent'
import { logFieldsOf } from '@dltech/atlas-observability'
import type { PodCrew, SubagentSaid, SubagentSnapshot } from '@dltech/atlas-plugin-sdk'

import type { RoleModelChoice } from '../ports'
import type { LeaseLostError, SessionRecord } from '../record/record-adapter'
import { ChildIntake } from './child-intake'
import { childPortOf } from './child-port'
import { childChoiceOf } from './child-model'
import {
  failureOf,
  progressOf,
  snapshotOf,
  statusOf,
  activeWorktreeSnapshotOf,
} from './child-progress'
import { DRAIN_IN_FLIGHT_CAP_MS } from '../drain-cap'
import { childRunnerOf } from './child-runner'
import { ChildTranscript } from './child-transcript'
import { driveLifecycle, type DriveArgs } from './child-turns'
import { lastSeqOf } from './child-reports'
import {
  adoptRecordOf,
  childRecordOf,
  seedWorktreeOf,
  type AdoptedChildArgs,
  type ChildRunArgs,
} from './child-record'

export type { AdoptedChildArgs, ChildRunArgs }

export class ChildRun {
  readonly agentId: ThreadId
  readonly startedAt: string
  private readonly intake = new ChildIntake()
  private readonly transcript: ChildTranscript
  private readonly pauseSignal = new PauseSignal()
  private record!: SessionRecord
  private runner!: LoopTurnRunner
  private pump: Promise<void> | undefined
  private abort: AbortController | undefined
  private listeners: AbortController | undefined
  private stopping = false
  private handingOff = false
  private pausing: Promise<void> | undefined
  private ending: EAgentStatus | undefined
  private endedAt: string | undefined
  private killedBy: EKilledBy | undefined
  private failure: string | undefined

  private constructor(
    private readonly args: ChildRunArgs,
    agentId: ThreadId,
    private readonly model: RoleModelChoice,
    startedAt: string,
  ) {
    this.agentId = agentId
    this.startedAt = startedAt
    this.transcript = new ChildTranscript({
      deps: args.deps,
      runtime: args.runtime,
      model: this.model,
      parentRecord: args.parentRecord,
      parentThreadId: args.parentThreadId,
      agentId,
      agentType: args.agentType,
      intent: args.intent,
      lastSeq: () => lastSeqOf(this.record.eventCache().eventsAfter(0)),
    })
  }

  static async open(args: ChildRunArgs): Promise<ChildRun> {
    const run = new ChildRun(
      args,
      args.deps.ids.nextThreadId(),
      childChoiceOf({ runtime: args.runtime, agentType: args.agentType }),
      new Date(args.deps.timers.now()).toISOString(),
    )
    await args.deps.plane.createThread({ threadId: run.agentId, sessionId: args.deps.sessionId })
    run.record = await childRecordOf({
      args,
      agentId: run.agentId,
      onLeaseLost: (error) => run.lost(error),
    })
    if (args.worktree !== undefined)
      await seedWorktreeOf({
        record: run.record,
        ids: args.deps.ids,
        agentId: run.agentId,
        worktree: args.worktree,
      })
    await run.transcript.spawned({ worktree: args.worktree })
    return run
  }

  static async adopt(args: AdoptedChildArgs): Promise<ChildRun | undefined> {
    const run = new ChildRun(
      args,
      args.agentId,
      childChoiceOf({ runtime: args.runtime, agentType: args.agentType }),
      args.spawnedAt,
    )
    const record = await adoptRecordOf({
      args,
      agentId: args.agentId,
      onLeaseLost: (error) => run.lost(error),
    })
    if (record === undefined) return undefined
    run.record = record
    if (args.settled === undefined) await run.endSettledTurn()
    else {
      run.ending = args.settled.status
      run.endedAt = args.settled.endedAt
    }
    return run
  }

  get done(): Promise<void> {
    return this.pump ?? Promise.resolve()
  }

  async say(text: string): Promise<SubagentSaid> {
    if (this.pump !== undefined) {
      await this.record.append({
        threadId: this.agentId,
        runId: this.args.deps.ids.nextRunId(),
        drafts: [saidBody({ text })],
      })
      this.intake.accept()
      return { queued: true, snapshot: this.snapshot() }
    }
    this.begin({ text, restart: this.ending !== undefined })
    return { queued: false, snapshot: this.snapshot() }
  }

  async notice(event: EventBody): Promise<void> {
    this.intake.accept(event)
    if (this.pump === undefined) this.begin({ resume: true })
  }

  continueTurn(): void {
    if (!this.resumable()) return
    this.begin({ resume: true })
  }

  resumable(): boolean {
    return isResumableOf(this.record.eventCache().loopState())
  }

  stop(by: EKilledBy): SubagentSnapshot {
    this.stopping = true
    this.killedBy = by
    this.abort?.abort('agent_stop')
    return this.snapshot()
  }

  async endIdle(by: EKilledBy): Promise<void> {
    if (this.ending !== undefined || this.pump !== undefined) return
    await this.end({ status: EAgentStatus.Stopped, failure: undefined, killedBy: by })
  }

  pause(): Promise<void> {
    this.handingOff = true
    this.pauseSignal.pause()
    this.pausing ??= this.settleOrAbort()
    return this.pausing
  }

  private async settleOrAbort(): Promise<void> {
    if (await this.settledWithin(DRAIN_IN_FLIGHT_CAP_MS)) return
    this.args.deps.log?.warn({
      source: 'holder.drain',
      message: `sub-agent ${this.agentId} ran in flight for ${DRAIN_IN_FLIGHT_CAP_MS}ms, past the drain cap; aborting it for the hand-off`,
    })
    this.abort?.abort('handoff')
  }

  private settledWithin(ms: number): Promise<boolean> {
    const timers = this.args.deps.timers
    return new Promise<boolean>((resolve) => {
      const timer = timers.setTimeout(() => resolve(false), ms)
      void this.done.then(() => {
        timers.clearTimeout(timer)
        resolve(true)
      })
    })
  }

  dispose(): void {
    this.listeners?.abort()
  }

  isRunning(): boolean {
    return this.pump !== undefined
  }

  snapshot(): SubagentSnapshot {
    return snapshotOf({
      agentId: this.agentId,
      agentType: this.args.agentType,
      intent: this.args.intent,
      startedAt: this.startedAt,
      events: this.record.eventCache().eventsAfter(0),
      status:
        this.ending ?? (this.pump === undefined ? EAgentStatus.Stopped : EAgentStatus.Running),
      endedAt: this.endedAt,
      worktree: activeWorktreeSnapshotOf({
        events: this.record.eventCache().loopEventsAfter(0),
        spawned: this.args.worktree,
      }),
    })
  }

  private lost(error: LeaseLostError): void {
    this.args.onLeaseLost(error)
    this.abort?.abort('lease_lost')
  }

  port(): PodCrew {
    return childPortOf({ report: (report) => this.report(report) })
  }

  private begin(args: DriveArgs): void {
    this.pump = this.drive(args).catch((error: unknown) => {
      this.args.deps.log?.error({
        source: 'holder.crew',
        message: `sub-agent ${this.agentId} faulted`,
        ...logFieldsOf({ error }),
      })
    })
  }

  private async drive(drive: DriveArgs): Promise<void> {
    const listeners = new AbortController()
    const abort = new AbortController()
    this.listeners = listeners
    this.abort = abort
    try {
      this.runner = childRunnerOf({
        deps: this.args.deps,
        runtime: this.args.runtime,
        record: this.record,
        agentId: this.agentId,
        model: this.model,
        signal: listeners.signal,
        crew: this.port(),
        intake: this.intake,
        notify: (event) => this.notice(event),
        isDraining: () => this.handingOff,
        onFallback: (refs) => this.transcript.fellBack(refs),
      })
      await driveLifecycle({
        drive,
        runner: this.runner,
        intake: this.intake,
        pause: this.pauseSignal,
        threadId: this.agentId,
        signal: abort.signal,
        stopped: () => this.stopping,
        restarted: (via) => this.transcript.restarted({ via }),
        owedTurn: () => !this.stopping && this.intake.pending > 0,
        handingOff: () => this.handingOff,
        reset: () => this.resetDrive(),
        settle: (outcome) => this.settle(outcome),
      })
    } catch (error) {
      await this.settleFailure(error)
    } finally {
      this.pump = undefined
      this.abort = undefined
      this.listeners = undefined
      listeners.abort()
    }
  }

  private resetDrive(): void {
    this.stopping = false
    this.ending = undefined
    this.endedAt = undefined
    this.killedBy = undefined
    this.failure = undefined
  }

  private async settle(outcome: TurnOutcome): Promise<void> {
    if (this.handingOff) return
    const status = statusOf(outcome)
    const failure = failureOf(outcome)
    const killedBy =
      status === EAgentStatus.Stopped ? (this.killedBy ?? EKilledBy.Model) : undefined
    await this.end({ status, failure, killedBy })
  }

  private async settleFailure(error: unknown): Promise<void> {
    if (this.handingOff) return
    const message = error instanceof Error ? error.message : String(error)
    await this.end({ status: EAgentStatus.Failed, failure: message, killedBy: undefined })
  }

  private async endSettledTurn(): Promise<void> {
    if (!finishedTurnOf(this.record.eventCache().loopState())) return
    await this.end({ status: EAgentStatus.Finished, failure: undefined, killedBy: undefined })
  }

  private async end(args: {
    status: EAgentStatus
    failure: string | undefined
    killedBy: EKilledBy | undefined
  }): Promise<void> {
    const progress = progressOf(this.record.eventCache().eventsAfter(0))
    this.ending = args.status
    this.endedAt = new Date(this.args.deps.timers.now()).toISOString()
    this.failure = args.failure
    this.killedBy = args.killedBy
    await this.transcript.ended({ progress, ...args })
  }

  private async report(args: { kind: EReportKind; text: string }): Promise<SubagentSnapshot> {
    await this.transcript.reported(args)
    return this.snapshot()
  }
}
