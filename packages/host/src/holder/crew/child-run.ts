import {
  EAgentStatus,
  EKilledBy,
  finishedTurnOf,
  type AgentLost,
  type CrewRoomMember,
  EResumeOutcome,
  EResumePoint,
  INBOX_KIND_EVENT,
  inboxEventPayloadOf,
  resumeMarkedDraft,
  resumePointOf,
  type EventBody,
  type RunFailure,
  type ThreadId,
} from '@dltech/atlas-core'
import { PauseSignal, type LoopTurnRunner, type TurnOutcome } from '@dltech/atlas-agent'
import { logFieldsOf } from '@dltech/atlas-observability'
import type { PodCrew, SubagentSaid, SubagentSnapshot } from '@dltech/atlas-plugin-sdk'

import type { RoleModelChoice } from '../ports'
import { oweChildStoppedCalls } from '../stop-debts'
import type { LeaseLostError, SessionRecord } from '../record/record-adapter'
import { childInboxOf, type ChildInbox } from './child-inbox'
import { inboxInputOf, type CrewSender } from './child-message'
import { childPortOf } from './child-port'
import { childResumeAllowed } from './child-repair'
import { childChoiceOf } from './child-model'
import {
  failureOf,
  progressOf,
  recordedFailureOf,
  runFailureOf,
  snapshotOf,
  statusOf,
  activeWorktreeSnapshotOf,
} from './child-progress'
import { childRunnerOf } from './child-runner'
import { ChildTranscript } from './child-transcript'
import { GroupRunState } from './group-run-state'
import { drainChildTurn } from './child-drain'
import { driveLifecycle, type DriveArgs } from './child-turns'
import { lastSeqOf } from './child-reports'
import {
  adoptRecordOf,
  childRecordOf,
  holdsWorktreeOf,
  seedWorktreeOf,
  settleCallsOf,
  type AdoptedChildArgs,
  type ChildRunArgs,
} from './child-record'

export type { AdoptedChildArgs, ChildRunArgs }

export type AdoptedRun = { ok: true; run: ChildRun } | { ok: false; lost: AgentLost }

export class ChildRun {
  readonly agentId: ThreadId
  readonly startedAt: string
  private inbox!: ChildInbox
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
  private readonly group: GroupRunState
  private awaitingAdoptSettle = false
  private reopened = false
  private readonly posts: (post: () => Promise<void>) => Promise<void>

  private constructor(
    private readonly args: ChildRunArgs,
    agentId: ThreadId,
    private readonly model: RoleModelChoice,
    startedAt: string,
  ) {
    this.agentId = agentId
    this.startedAt = startedAt
    this.group = new GroupRunState(args.groupHold ?? ((draft) => draft))
    this.posts = args.postHold ?? ((post) => post())
    this.transcript = new ChildTranscript({
      deps: args.deps,
      runtime: args.runtime,
      model: this.model,
      parentRecord: args.parentRecord,
      parentThreadId: args.parentThreadId,
      agentId,
      agentType: args.agentType,
      intent: args.intent,
      group: args.group,
      lastSeq: () => lastSeqOf(this.record.eventCache().eventsAfter(0)),
    })
  }

  static async open(args: ChildRunArgs): Promise<ChildRun> {
    const key = args.key
    const run = new ChildRun(
      args,
      key?.agentId ?? args.deps.ids.nextThreadId(),
      childChoiceOf({ runtime: args.runtime, agentType: args.agentType }),
      new Date(args.deps.timers.now()).toISOString(),
    )
    const onLeaseLost = (error: LeaseLostError): void => {
      run.lost(error)
    }
    await args.deps.plane.createThread({ threadId: run.agentId, sessionId: args.deps.sessionId })
    run.record = await childRecordOf({ args, agentId: run.agentId, onLeaseLost })
    run.inbox = childInboxOf({ deps: args.deps, record: run.record, threadId: run.agentId })
    const reopened = key !== undefined && run.record.eventCache().eventsAfter(0).length > 0
    if (reopened)
      await settleCallsOf({ args, agentId: run.agentId, onLeaseLost, record: run.record })
    if (args.worktree !== undefined && !holdsWorktreeOf(run.record))
      await seedWorktreeOf({
        record: run.record,
        ids: args.deps.ids,
        agentId: run.agentId,
        worktree: args.worktree,
      })
    await run.transcript.spawned({
      worktree: args.worktree,
      ...(key === undefined ? {} : { callId: key.callId, stepKey: key.stepKey }),
    })
    run.reopened = reopened
    return run
  }

  static async adopt(args: AdoptedChildArgs): Promise<AdoptedRun> {
    const run = new ChildRun(
      args,
      args.agentId,
      childChoiceOf({ runtime: args.runtime, agentType: args.agentType }),
      args.spawnedAt,
    )
    const adopted = await adoptRecordOf({
      args,
      agentId: args.agentId,
      onLeaseLost: (error) => run.lost(error),
    })
    if (!adopted.ok) return adopted
    run.record = adopted.record
    run.inbox = childInboxOf({ deps: args.deps, record: adopted.record, threadId: run.agentId })
    run.awaitingAdoptSettle = args.settled === undefined
    if (args.settled !== undefined) {
      run.ending = args.settled.status
      run.endedAt = args.settled.endedAt
    }
    return { ok: true, run }
  }

  async finishAdopted(): Promise<void> {
    if (!this.awaitingAdoptSettle) return
    this.awaitingAdoptSettle = false
    await this.endSettledTurn()
  }

  async continueExisting(): Promise<void> {
    if (!this.reopened) return
    await this.endSettledTurn()
    await this.continueTurn()
  }

  get done(): Promise<void> {
    return this.pump ?? Promise.resolve()
  }

  async say(args: {
    text: string
    from?: CrewSender | undefined
    clientId?: string | undefined
  }): Promise<SubagentSaid> {
    await this.inbox.post({
      ...inboxInputOf(args),
      ...(args.clientId === undefined ? {} : { receipt: args.clientId }),
    })
    if (this.pump !== undefined) return { queued: true, snapshot: this.snapshot() }
    if (!(await this.inbox.intake.hasQueued())) return { queued: false, snapshot: this.snapshot() }
    this.begin({ restart: this.ending !== undefined })
    return { queued: false, snapshot: this.snapshot() }
  }

  async notice(event: EventBody, options: { key: string }): Promise<void> {
    await this.inbox.post({
      kind: INBOX_KIND_EVENT,
      payload: inboxEventPayloadOf({ event, clientId: options.key }),
    })
    if (this.pump === undefined) this.begin({ resume: true })
  }

  async continueTurn(args: { retry?: boolean; resume?: boolean } = {}): Promise<void> {
    const { agentId, record } = this
    const resume = childResumeAllowed({ agentId, record, retry: args.retry === true })
    if (this.pump !== undefined) return
    if (!resume && !(await this.inbox.intake.hasQueued())) return
    this.begin(
      args.resume === true || this.ending === undefined ? { resume: true } : { restart: true },
    )
  }

  async resume(): Promise<EResumeOutcome> {
    if (this.pump !== undefined) return EResumeOutcome.Running
    const point = resumePointOf({ events: this.record.eventCache().eventsAfter(0) })
    if (point.kind === EResumePoint.NotResumable) return EResumeOutcome.NotResumable
    await this.record.append({
      threadId: this.agentId,
      runId: this.args.deps.ids.nextRunId(),
      drafts: [resumeMarkedDraft({ point })],
    })
    await this.continueTurn({ resume: true })
    return EResumeOutcome.Resumed
  }

  stop(by: EKilledBy): SubagentSnapshot {
    this.stopping = true
    this.killedBy = by
    void oweChildStoppedCalls({
      child: this.record,
      parent: this.args.parentRecord,
      runId: () => this.args.deps.ids.nextRunId(),
      ...(this.args.deps.log === undefined ? {} : { log: this.args.deps.log }),
    })
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
    this.pausing ??= drainChildTurn({
      timers: this.args.deps.timers,
      drainCapMs: this.args.deps.drainCapMs,
      agentId: this.agentId,
      pause: this.pauseSignal,
      done: this.done,
      log: this.args.deps.log,
    })
    return this.pausing
  }

  handoff(): void {
    this.handingOff = true
    this.abort?.abort('handoff')
  }

  dispose(): void {
    this.listeners?.abort()
  }

  isRunning(): boolean {
    return this.pump !== undefined
  }

  member(): CrewRoomMember {
    return {
      agentId: this.agentId,
      agentType: this.args.agentType,
      group: this.args.group,
      running: this.group.runningForGroup,
    }
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
    this.abort?.abort('handoff')
  }

  port(): PodCrew {
    return childPortOf({
      say: (said) =>
        this.args.saySibling({
          ...said,
          from: { agentId: this.agentId, agentType: this.args.agentType, intent: this.args.intent },
        }),
      report: (report) => this.report(report),
    })
  }

  private begin(args: DriveArgs): void {
    this.group.started()
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
        parentThreadId: this.args.parentThreadId,
        agentId: this.agentId,
        epoch: this.args.epoch,
        model: this.model,
        signal: listeners.signal,
        crew: this.port(),
        parentRecord: this.args.parentRecord,
        intake: this.inbox.intake,
        notify: (event, options) => this.notice(event, options),
        isDraining: () => this.handingOff,
        onFallback: (refs) => this.transcript.fellBack(refs),
      })
      await driveLifecycle({
        drive,
        runner: this.runner,
        pause: this.pauseSignal,
        threadId: this.agentId,
        signal: abort.signal,
        stopped: () => this.stopping,
        restarted: (via) => this.transcript.restarted({ via }),
        owedTurn: async () => !this.stopping && (await this.inbox.intake.hasQueued()),
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
    this.group.started()
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
    await this.end({ status, failure, runFailure: runFailureOf(outcome), killedBy })
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
    runFailure?: RunFailure | undefined
    killedBy: EKilledBy | undefined
  }): Promise<void> {
    const progress = progressOf(this.record.eventCache().eventsAfter(0))
    const runFailure = args.runFailure ?? recordedFailureOf(this.record.eventCache().eventsAfter(0))
    this.ending = args.status
    this.endedAt = new Date(this.args.deps.timers.now()).toISOString()
    this.failure = args.failure
    this.killedBy = args.killedBy
    const draft = this.group.ended(this.transcript.endingDraft({ progress, ...args, runFailure }))
    await this.posts(() => this.transcript.ended({ draft }))
  }

  private async report(args: {
    text: string
    clientId?: string | undefined
  }): Promise<SubagentSnapshot> {
    await this.posts(() => this.transcript.reported(args))
    return this.snapshot()
  }
}
