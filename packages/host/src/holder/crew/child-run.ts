import {
  EAgentRestart,
  EAgentStart,
  EAgentStatus,
  EKilledBy,
  EReportKind,
  reportWakesParent,
  type EventDraft,
  type ThreadId,
} from '@dltech/atlas-core'
import { ETurnStatus, type LoopTurnRunner, type TurnOutcome } from '@dltech/atlas-agent'
import type {
  PodCrew,
  SubagentSaid,
  SubagentSnapshot,
  SubagentWorktree,
  WorktreeEntryInfo,
} from '@dltech/atlas-plugin-sdk'

import type { HeldSessionDeps } from '../held-session-deps'
import type { SessionRuntime } from '../ports'
import type { LeaseLostError, SessionRecord } from '../record/record-adapter'
import { SessionRecord as RecordAdapter } from '../record/record-adapter'
import { ChildIntake } from './child-intake'
import { childPortOf } from './child-port'
import {
  failureOf,
  progressOf,
  snapshotOf,
  statusOf,
  activeWorktreeSnapshotOf,
  worktreeDraftOf,
} from './child-progress'
import {
  appendOnParent,
  endingTextOf,
  reportTextOf,
  wakeParent,
  type ChildParent,
} from './child-reports'
import { childRunnerOf } from './child-runner'

export type ChildRunArgs = {
  deps: HeldSessionDeps
  runtime: SessionRuntime
  parentRecord: SessionRecord
  parentThreadId: ThreadId
  epoch: number
  agentType: string
  intent: string
  worktree?: WorktreeEntryInfo | undefined
  signal: AbortSignal
  onLeaseLost(error: LeaseLostError): void
  drainDeadline(): number | undefined
}

export class ChildRun {
  readonly agentId: ThreadId
  readonly startedAt: string
  private readonly intake = new ChildIntake()
  private record!: SessionRecord
  private runner!: LoopTurnRunner
  private pump: Promise<void> | undefined
  private abort: AbortController | undefined
  private listeners: AbortController | undefined
  private stopping = false
  private woke = false
  private ending: EAgentStatus | undefined
  private endedAt: string | undefined
  private killedBy: EKilledBy | undefined
  private failure: string | undefined

  private constructor(
    private readonly args: ChildRunArgs,
    agentId: ThreadId,
  ) {
    this.agentId = agentId
    this.startedAt = new Date(args.deps.timers.now()).toISOString()
  }

  static async open(args: ChildRunArgs): Promise<ChildRun> {
    const run = new ChildRun(args, args.deps.ids.nextThreadId())
    await args.deps.plane.createThread({ threadId: run.agentId, sessionId: args.deps.sessionId })
    run.record = await RecordAdapter.open({
      plane: args.deps.plane,
      threadId: run.agentId,
      epoch: args.epoch,
      timers: args.deps.timers,
      remoteCalls: args.runtime.remoteCalls,
      daemonTools: args.runtime.daemonTools,
      appendRetryMs: args.deps.appendRetryMs,
      drainDeadline: args.drainDeadline,
      onLeaseLost: (error) => {
        args.onLeaseLost(error)
        run.abort?.abort('lease_lost')
      },
      nowIso: () => new Date(args.deps.timers.now()).toISOString(),
      ...(args.deps.log === undefined ? {} : { log: args.deps.log }),
    })
    if (args.worktree !== undefined) await run.seedWorktree(args.worktree)
    await run.appendToParent([
      {
        type: 'agent-spawned',
        agentId: run.agentId,
        agentType: args.agentType,
        intent: args.intent,
        mode: EAgentStart.Fresh,
        ...(args.worktree === undefined ? {} : { worktree: worktreeDraftOf(args.worktree) }),
      },
    ])
    return run
  }

  get done(): Promise<void> {
    return this.pump ?? Promise.resolve()
  }

  async say(text: string): Promise<SubagentSaid> {
    if (this.pump !== undefined) {
      this.intake.push(text)
      return { queued: true, snapshot: this.snapshot() }
    }
    const restart = this.ending !== undefined
    const pump = this.drive({ text, restart }).catch(() => undefined)
    this.pump = pump
    return { queued: false, snapshot: this.snapshot() }
  }

  stop(by: EKilledBy): SubagentSnapshot {
    this.stopping = true
    this.killedBy = by
    this.abort?.abort('agent_stop')
    return this.snapshot()
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
      worktree: this.worktreeOf,
    })
  }

  get worktreeOf(): SubagentWorktree | undefined {
    return activeWorktreeSnapshotOf({
      events: this.record.eventCache().loopEventsAfter(0),
      spawned: this.args.worktree,
    })
  }

  private async seedWorktree(worktree: WorktreeEntryInfo): Promise<void> {
    await this.record.append({
      threadId: this.agentId,
      runId: this.args.deps.ids.nextRunId(),
      drafts: [
        {
          type: 'worktree-entered',
          path: worktree.path,
          branch: worktree.branch,
          ...(worktree.base === undefined ? {} : { base: worktree.base }),
          adopted: worktree.adopted === true,
        },
      ],
    })
  }

  port(): PodCrew {
    return childPortOf({ report: (report) => this.report(report) })
  }

  private get parent(): ChildParent {
    return {
      deps: this.args.deps,
      record: this.args.parentRecord,
      threadId: this.args.parentThreadId,
      agentId: this.agentId,
      agentType: this.args.agentType,
      intent: this.args.intent,
    }
  }

  private async drive(args: { text: string; restart: boolean }): Promise<void> {
    const listeners = new AbortController()
    const abort = new AbortController()
    this.listeners = listeners
    this.abort = abort
    this.stopping = false
    this.woke = false
    this.ending = undefined
    this.endedAt = undefined
    this.killedBy = undefined
    this.failure = undefined
    try {
      this.runner = childRunnerOf({
        deps: this.args.deps,
        runtime: this.args.runtime,
        record: this.record,
        agentId: this.agentId,
        signal: listeners.signal,
        crew: this.port(),
        intake: this.intake,
      })
      if (args.restart) await this.announceRestart()
      let outcome = await this.turn({ text: args.text, signal: abort.signal })
      while (
        outcome.status === ETurnStatus.Completed &&
        !this.stopping &&
        this.intake.pending > 0
      ) {
        outcome = await this.turn({ text: undefined, signal: abort.signal })
      }
      await this.settle(outcome)
    } catch (error) {
      await this.settleFailure(error)
    } finally {
      this.pump = undefined
      this.abort = undefined
      this.listeners = undefined
      listeners.abort()
    }
  }

  private turn(args: { text: string | undefined; signal: AbortSignal }): Promise<TurnOutcome> {
    const request = { threadId: this.agentId, signal: args.signal }
    return args.text === undefined
      ? this.runner.runTurn(request)
      : this.runner.say({ ...request, text: args.text })
  }

  private async settle(outcome: TurnOutcome): Promise<void> {
    const status = statusOf(outcome)
    const failure = failureOf(outcome)
    const killedBy =
      status === EAgentStatus.Stopped ? (this.killedBy ?? EKilledBy.Model) : undefined
    await this.end({ status, failure, killedBy })
  }

  private async settleFailure(error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error)
    await this.end({ status: EAgentStatus.Failed, failure: message, killedBy: undefined })
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
    await this.appendToParent([
      {
        type: 'agent-ended',
        agentId: this.agentId,
        agentType: this.args.agentType,
        intent: this.args.intent,
        status: args.status,
        prose: progress.prose,
        turns: progress.turns,
        toolCalls: progress.toolCalls,
        ...(args.killedBy === undefined ? {} : { killedBy: args.killedBy }),
        ...(args.failure === undefined ? {} : { failureCause: args.failure }),
      },
    ])
    if (this.woke) return
    if (args.status === EAgentStatus.Finished && progress.prose !== '') {
      await this.appendToParent([
        {
          type: 'agent-reported',
          agentId: this.agentId,
          agentType: this.args.agentType,
          intent: this.args.intent,
          prose: progress.prose,
          kind: EReportKind.Done,
        },
      ])
    }
    await wakeParent(
      this.parent,
      endingTextOf({
        parent: this.parent,
        progress,
        status: args.status,
        failure: args.failure,
        killedBy: this.killedBy,
      }),
    )
  }

  private async report(args: { kind: EReportKind; text: string }): Promise<SubagentSnapshot> {
    await this.appendToParent([
      {
        type: 'agent-reported',
        agentId: this.agentId,
        agentType: this.args.agentType,
        intent: this.args.intent,
        prose: args.text,
        kind: args.kind,
      },
    ])
    if (reportWakesParent(args.kind)) {
      await wakeParent(this.parent, reportTextOf(this.parent, args.kind))
      this.woke = true
    }
    return this.snapshot()
  }

  private async announceRestart(): Promise<void> {
    await this.appendToParent([
      {
        type: 'agent-restarted',
        agentId: this.agentId,
        agentType: this.args.agentType,
        intent: this.args.intent,
        via: EAgentRestart.Message,
      },
    ])
  }

  private async appendToParent(drafts: readonly EventDraft[]): Promise<void> {
    await appendOnParent(this.parent, drafts)
  }
}
