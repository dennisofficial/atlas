import {
  agentEnding,
  awaitsReplyOf,
  EAgentRestart,
  EAgentStart,
  EAgentStatus,
  EKilledBy,
  EReportKind,
  saidBody,
  type AssistantPart,
  type EventDraft,
  type V2Event,
  type ThreadId,
} from '@dltech/atlas-core'
import {
  ETurnStatus,
  HookChain,
  HookedToolDispatcher,
  LoopTurnRunner,
  type AgentIntake,
  type TurnOutcome,
} from '@dltech/atlas-agent'
import type { PodCrew, SubagentSaid, SubagentSnapshot } from '@dltech/atlas-plugin-sdk'
import { INBOX_KIND_MESSAGE } from '@dltech/atlas-protocol'

import { ScopedToolDispatcher } from '../../calls/call-scope'
import type { HeldSessionDeps } from '../held-session-deps'
import { pluginHooksOf, pluginPodContextOf, pluginToolsOf } from '../plugin-pod'
import type { SessionRuntime } from '../ports'
import type { SessionRecord } from '../record/record-adapter'
import { SessionRecord as RecordAdapter } from '../record/record-adapter'
import { V2OnceLedger } from '../record/v2-once-ledger'
import { retryDepsFromTimers } from '../timer-sleep'
import { DeniedToolRegistry } from './child-tools'

export type ChildRunArgs = {
  deps: HeldSessionDeps
  runtime: SessionRuntime
  parentRecord: SessionRecord
  parentThreadId: ThreadId
  epoch: number
  agentType: string
  intent: string
  signal: AbortSignal
}

type Progress = { turns: number; toolCalls: number; prose: string; lastTool: string | undefined }

const spokenText = (parts: readonly AssistantPart[]): string =>
  parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim()

const progressOf = (events: readonly V2Event[]): Progress => {
  let turns = 0
  let toolCalls = 0
  let prose = ''
  let lastTool: string | undefined
  for (const event of events) {
    if (event.type === 'tool-called') {
      toolCalls += 1
      lastTool = event.name
      continue
    }
    if (event.type !== 'assistant-said') continue
    turns += 1
    const said = spokenText(event.parts)
    if (said !== '') prose = said
  }
  return { turns, toolCalls, prose, lastTool }
}

const childIntake: AgentIntake = {
  prepare: async () => ({ drafts: [], wakesTurn: false }),
}

const statusOf = (outcome: TurnOutcome): EAgentStatus => {
  switch (outcome.status) {
    case ETurnStatus.Failed:
      return EAgentStatus.Failed
    case ETurnStatus.Interrupted:
      return EAgentStatus.Stopped
    case ETurnStatus.Paused:
      return EAgentStatus.Blocked
    case ETurnStatus.HandoffPaused:
      return EAgentStatus.Paused
    case ETurnStatus.WaitingForModel:
      return EAgentStatus.WaitingForModel
    default:
      return EAgentStatus.Finished
  }
}

const failureOf = (outcome: TurnOutcome): string | undefined =>
  outcome.status === ETurnStatus.Failed ? outcome.message : undefined

const refusal = (message: string): Error => new Error(message)

export class ChildRun {
  readonly agentId: ThreadId
  readonly startedAt: string
  private record!: SessionRecord
  private runner!: LoopTurnRunner
  private abort: AbortController | undefined
  private tail: Promise<void> = Promise.resolve()
  private running = false
  private ending: EAgentStatus | undefined
  private endedAt: string | undefined
  private killedBy: EKilledBy | undefined
  private failure: string | undefined
  private reported = false

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
      nowIso: () => new Date(args.deps.timers.now()).toISOString(),
      ...(args.deps.log === undefined ? {} : { log: args.deps.log }),
    })
    run.runner = run.buildRunner()
    await run.appendToParent([
      {
        type: 'agent-spawned',
        agentId: run.agentId,
        agentType: args.agentType,
        intent: args.intent,
        mode: EAgentStart.Fresh,
      },
    ])
    return run
  }

  get done(): Promise<void> {
    return this.tail
  }

  start(prompt: string): void {
    this.running = true
    this.abort = new AbortController()
    this.tail = this.runTurn(prompt).catch(() => undefined)
  }

  async say(text: string): Promise<SubagentSaid> {
    if (this.running) {
      await this.record.append({
        threadId: this.agentId,
        runId: this.args.deps.ids.nextRunId(),
        drafts: [saidBody({ text })],
      })
      return { queued: true, snapshot: this.snapshot() }
    }
    const resumed = this.ending !== undefined
    this.ending = undefined
    this.endedAt = undefined
    this.killedBy = undefined
    this.failure = undefined
    this.reported = false
    this.running = true
    this.abort = new AbortController()
    this.tail = (resumed ? this.announceRestart() : Promise.resolve())
      .then(() => this.runTurn(text))
      .catch(() => undefined)
    return { queued: false, snapshot: this.snapshot() }
  }

  stop(by: EKilledBy): SubagentSnapshot {
    this.killedBy = by
    this.abort?.abort('agent_stop')
    return this.snapshot()
  }

  isRunning(): boolean {
    return this.running
  }

  snapshot(): SubagentSnapshot {
    const progress = progressOf(this.record.eventCache().eventsAfter(0))
    return {
      agentId: this.agentId,
      agentType: this.args.agentType,
      intent: this.args.intent,
      status: this.ending ?? (this.running ? EAgentStatus.Running : EAgentStatus.Stopped),
      turns: progress.turns,
      toolCalls: progress.toolCalls,
      startedAt: this.startedAt,
      ...(this.endedAt === undefined ? {} : { endedAt: this.endedAt }),
      ...(progress.prose === '' ? {} : { prose: progress.prose }),
      ...(progress.lastTool === undefined ? {} : { lastTool: progress.lastTool }),
    }
  }

  port(): PodCrew {
    return {
      spawn: async () => {
        throw refusal('a sub-agent cannot spawn sub-agents')
      },
      say: async () => {
        throw refusal('a sub-agent cannot message other agents')
      },
      stop: async () => {
        throw refusal('a sub-agent cannot stop other agents')
      },
      list: () => [],
      report: async ({ kind, text }) => this.report({ kind, text }),
    }
  }

  private buildRunner(): LoopTurnRunner {
    const { deps, runtime } = this.args
    const ctx = pluginPodContextOf({
      deps,
      runtime,
      record: this.record,
      threadId: this.agentId,
      signal: this.args.signal,
      crew: this.port(),
    })
    const deny = runtime.plugins?.pod.childDeny ?? []
    const registry = new DeniedToolRegistry(pluginToolsOf({ runtime, ctx }), deny)
    const hooks: HookChain = pluginHooksOf({ runtime, ctx })
    return new LoopTurnRunner({
      record: this.record,
      modelContext: this.record,
      model: runtime.model,
      ids: deps.ids,
      assembly: runtime.assembly,
      hooks,
      tools: () => registry.declarations(),
      dispatch: new ScopedToolDispatcher(new HookedToolDispatcher({ registry, hooks })),
      intake: childIntake,
      launchDirectory: runtime.launchDirectory,
      normalizeFailure: runtime.normalizeFailure,
      retry: retryDepsFromTimers(deps.timers),
      onceLedger: new V2OnceLedger({
        cache: this.record.eventCache(),
        record: this.record,
        threadId: this.agentId,
        runId: () => deps.ids.nextRunId(),
      }),
      ...(deps.log === undefined ? {} : { logPort: deps.log }),
      ...(runtime.uploads === undefined ? {} : { uploads: runtime.uploads }),
      ...(runtime.mediaUrls === undefined ? {} : { mediaUrls: runtime.mediaUrls }),
    })
  }

  private async runTurn(text: string | undefined): Promise<void> {
    const signal = this.abort?.signal
    try {
      const outcome =
        text === undefined
          ? await this.runner.runTurn({
              threadId: this.agentId,
              ...(signal === undefined ? {} : { signal }),
            })
          : await this.runner.say({
              threadId: this.agentId,
              text,
              ...(signal === undefined ? {} : { signal }),
            })
      await this.drainQueued(signal)
      await this.settle(outcome)
    } catch (error) {
      await this.settleFailure(error)
    } finally {
      this.running = false
      this.abort = undefined
    }
    await this.followQueued()
  }

  private async followQueued(): Promise<void> {
    const signal = this.args.signal
    if (signal.aborted) return
    const state = await this.record.loopState({ threadId: this.agentId })
    if (!awaitsReplyOf(state)) return
    this.ending = undefined
    this.endedAt = undefined
    this.killedBy = undefined
    this.failure = undefined
    this.reported = false
    await this.announceRestart()
    this.running = true
    this.abort = new AbortController()
    await this.runTurn(undefined)
  }

  private async drainQueued(signal: AbortSignal | undefined): Promise<void> {
    for (;;) {
      const state = await this.record.loopState({ threadId: this.agentId })
      if (!awaitsReplyOf(state)) return
      const outcome = await this.runner.runTurn({
        threadId: this.agentId,
        ...(signal === undefined ? {} : { signal }),
      })
      if (outcome.status !== ETurnStatus.Completed) return
    }
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
    if (!this.reported) {
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
      await this.wake({
        text: this.endingText({ progress, status: args.status, failure: args.failure }),
      })
    }
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
    await this.wake({
      text: [
        `Sub-agent ${this.agentId} (${this.args.agentType}, "${this.args.intent}") reported ${args.kind}.`,
        '',
        args.text,
      ].join('\n'),
    })
    this.reported = true
    return this.snapshot()
  }

  private endingText(args: {
    progress: Progress
    status: EAgentStatus
    failure: string | undefined
  }): string {
    const ending = agentEnding({
      status: args.status,
      turns: args.progress.turns,
      toolCalls: args.progress.toolCalls,
      ...(this.killedBy === undefined ? {} : { killedBy: this.killedBy }),
      ...(args.failure === undefined ? {} : { failureCause: args.failure }),
    })
    return [
      `Sub-agent ${this.agentId} (${this.args.agentType}, "${this.args.intent}") ${ending}.`,
      ...(args.progress.prose === '' ? [] : ['', args.progress.prose]),
    ].join('\n')
  }

  private async wake(args: { text: string }): Promise<void> {
    await this.args.deps.plane.post({
      sessionId: this.args.deps.sessionId,
      kind: INBOX_KIND_MESSAGE,
      payload: JSON.stringify({ text: args.text }),
    })
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
    await this.args.parentRecord.append({
      threadId: this.args.parentThreadId,
      runId: this.args.deps.ids.nextRunId(),
      drafts,
    })
  }
}
