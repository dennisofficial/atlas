import {
  AUTO_COMPACT_OFF,
  estimateTokensFor,
  imageTierOf,
  saidBody,
  type Assembled,
  type ThreadId,
  type EventDraft,
  type SaidFile,
  type SaidImage,
  type SaidUpload,
  type IdPort,
  type ModelPort,
} from '@dltech/atlas-core'

import type { AgentRecordPort } from '../record/agent-record.port'
import type { OnceLedger } from './once-ledger.port'
import type { AgentOutput } from './agent-output'
import { retryDepsFor } from './retry-deps'
import type { PauseSignal } from './pause-signal'
import type { PendingDrain } from './pending-intake'
import type { ExpandContext } from '../intake/pending-said'
import type { RetryDeps } from './retrying-step'
import type { SleepPrevention } from './loop-ports'
import { openTurnSpend, TURN_CRASHED, type TurnLedgerDeps } from '../ledger/record-turn-spend'
import {
  runFailureWith,
  type FailureDiagnostics,
  type NormalizeFailure,
} from '../model/run-failure'
import { recordEscapedFailure, recordRunFailure } from './recorded-failures'
import { appendResumeDrafts } from './resume-turn'
import { createSettlePending } from './settle-pending'
import { runTrackedTurn, type TrackedTurnDeps } from './tracked-turn'
import { ETurnStatus, type TurnOutcome } from './turn-outcome'
import { TurnRunner } from './turn-runner.port'
import type { TurnDeps } from './turn-deps'
import type { LogPort, TracePort } from '@dltech/atlas-observability'
import { traceTurn, tracedTurnDeps } from '../trace/traced-turn-deps'

export type { PendingDrain }
export type { TurnDeps } from './turn-deps'

export class LoopTurnRunner extends TurnRunner {
  private readonly record: AgentRecordPort
  private readonly model: ModelPort
  private readonly ids: IdPort
  private readonly spend: TurnLedgerDeps | undefined
  private readonly logPort: LogPort | undefined
  private readonly retry: RetryDeps | undefined
  private readonly output: AgentOutput | undefined
  private readonly sleepPrevention: SleepPrevention | undefined
  private readonly onceLedger: OnceLedger | undefined
  private readonly tracked: TrackedTurnDeps
  private readonly normalizeFailure: NormalizeFailure
  private readonly failureDiagnostics: FailureDiagnostics | undefined
  private readonly expandContext: ExpandContext | undefined
  private readonly trace: TracePort | undefined

  constructor(untraced: TurnDeps) {
    super()
    const deps = tracedTurnDeps(untraced)
    this.trace = deps.trace
    this.record = deps.record
    this.model = deps.model
    this.ids = deps.ids
    this.spend = deps.spend
    this.logPort = deps.logPort
    this.retry = deps.retry
    this.output = deps.output
    this.sleepPrevention = deps.sleepPrevention
    this.onceLedger = deps.onceLedger
    this.expandContext = deps.expandContext
    this.normalizeFailure = deps.normalizeFailure
    this.failureDiagnostics = deps.failureDiagnostics

    const tools = deps.tools ?? (() => [])
    const countTokens =
      deps.countTokens ??
      ((assembled: Assembled) => estimateTokensFor(imageTierOf(deps.model))(assembled))

    this.tracked = {
      record: deps.record,
      modelContext: deps.modelContext,
      model: deps.model,
      ids: deps.ids,
      assembly: deps.assembly,
      tools,
      countTokens,
      onChunk: deps.onChunk,
      onContext:
        deps.output === undefined
          ? undefined
          : ({ tokens, window }) => deps.output?.emit({ type: 'context-size', tokens, window }),
      hooks: deps.hooks,
      uploads: deps.uploads,
      intake: deps.intake,
      settlePending:
        deps.dispatch === undefined
          ? undefined
          : createSettlePending({
              record: deps.record,
              dispatch: deps.dispatch,
              tools,
              launchDirectory: deps.launchDirectory,
              onceLedger: deps.onceLedger,
              onToolOutput:
                deps.output === undefined
                  ? undefined
                  : (output) => deps.output?.emit({ type: 'tool-output', output }),
            }),
      onceLedger: deps.onceLedger,
      compact: deps.compact,
      applyLoopCut: deps.applyLoopCut,
      onLoopCut: deps.onLoopCut,
      watchLoop: deps.watchLoop,
      onLoopWatch: deps.onLoopWatch,
      onLoopWatchCut: deps.onLoopWatchCut,
      onLoopStop: deps.onLoopStop,
      autoCompactAtPercent: deps.autoCompactAtPercent ?? (() => AUTO_COMPACT_OFF),
      launchDirectory: deps.launchDirectory,
      retry: deps.retry,
      waitState: deps.waitState,
      normalizeFailure: deps.normalizeFailure,
      trace: deps.trace,
    }
  }

  private retryFor({ threadId }: { threadId: ThreadId }): RetryDeps | undefined {
    return retryDepsFor({
      retry: this.retry,
      output: this.output,
      logPort: this.logPort,
      diagnostics: this.failureDiagnostics,
      threadId,
    })
  }

  async say({
    threadId,
    text,
    requestId,
    images,
    files,
    uploads,
    context,
    signal,
    pause,
  }: {
    threadId: ThreadId
    text: string
    requestId?: string | undefined
    images?: readonly SaidImage[]
    files?: readonly SaidFile[]
    uploads?: readonly SaidUpload[]
    context?: readonly EventDraft[]
    signal?: AbortSignal
    pause?: PauseSignal
  }): Promise<TurnOutcome> {
    const held = context ?? []
    const expanded = this.expandContext?.({ text, context: held }) ?? []
    await this.record.append({
      threadId,
      runId: this.ids.nextRunId(),
      drafts: [...held, ...expanded, saidBody({ text, requestId, images, files, uploads })],
    })
    return this.runTurn({
      threadId,
      ...(signal === undefined ? {} : { signal }),
      ...(pause === undefined ? {} : { pause }),
    })
  }

  async resume({
    threadId,
    signal,
    pause,
  }: {
    threadId: ThreadId
    signal?: AbortSignal
    pause?: PauseSignal
  }): Promise<TurnOutcome> {
    await appendResumeDrafts({
      record: this.record,
      ids: this.ids,
      threadId,
      expandContext: this.expandContext,
    })
    return this.runTurn({
      threadId,
      ...(signal === undefined ? {} : { signal }),
      ...(pause === undefined ? {} : { pause }),
    })
  }

  async runTurn({
    threadId,
    signal,
    pause,
  }: {
    threadId: ThreadId
    signal?: AbortSignal
    pause?: PauseSignal
  }): Promise<TurnOutcome> {
    return traceTurn({
      trace: this.trace,
      model: this.model,
      threadId,
      run: () =>
        this.runTracedTurn({
          threadId,
          ...(signal === undefined ? {} : { signal }),
          ...(pause === undefined ? {} : { pause }),
        }),
    })
  }

  private async runTracedTurn({
    threadId,
    signal,
    pause,
  }: {
    threadId: ThreadId
    signal?: AbortSignal
    pause?: PauseSignal
  }): Promise<TurnOutcome> {
    const runId = this.ids.nextRunId()
    const spend = openTurnSpend({ ...(this.spend ?? {}), model: this.model.identity })
    let status: string = TURN_CRASHED
    // A turn that parks for a human does so by returning Paused, which drops this lease — the
    // assertion rides again on resume() rather than surviving a wait nobody is driving.
    const releaseSleepAssertion = this.sleepPrevention?.acquire()

    try {
      const outcome = await runTrackedTurn(
        { ...this.tracked, retry: this.retryFor({ threadId }) },
        {
          threadId,
          runId,
          spend,
          ...(signal === undefined ? {} : { signal }),
          ...(pause === undefined ? {} : { pause }),
        },
      )
      status = outcome.status
      if (outcome.status === ETurnStatus.Failed) {
        const failure = runFailureWith({
          normalize: this.normalizeFailure,
          message: outcome.message,
          cause: outcome.cause,
          providerId: this.model.identity.id,
          modelId: this.model.identity.modelId,
        })
        await recordRunFailure({ record: this.record, threadId, runId, failure })
        return { ...outcome, failure }
      }
      return outcome
    } catch (error) {
      await recordEscapedFailure({
        record: this.record,
        threadId,
        runId,
        error,
        identity: this.model.identity,
        normalizeFailure: this.normalizeFailure,
      })
      throw error
    } finally {
      releaseSleepAssertion?.()
      await spend.settle({ threadId, runId, status })
    }
  }
}
