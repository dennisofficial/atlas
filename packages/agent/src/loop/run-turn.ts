import {
  AUTO_COMPACT_OFF,
  estimateTokensFor,
  imageTierOf,
  saidBody,
  type Assembled,
  type AssemblyPipeline,
  type ThreadId,
  type ChunkFilter,
  type EventDraft,
  type EventLogPort,
  type SaidFile,
  type SaidImage,
  type SaidUpload,
  type IdPort,
  type LogPort,
  type LoopCut,
  type ModelPort,
  type ToolDeclaration,
} from '@dltech/atlas-core'

import { logFieldsOf } from '../logging/log-fields'
import type { AgentIntake } from '../intake/agent-intake'
import type { HookChain } from '../hooks/registry'
import type { SaidUploadsPort } from '../uploads/said-uploads.port'
import type { ApplyLoopCut } from '../loop-cut'
import type { ToolDispatcher } from '../tools/dispatch'
import type { LoopWatch } from './loop-watchdog'
import type { PauseSignal } from './pause-signal'
import type { PendingDrain } from './pending-intake'
import type { ExpandContext } from '../intake/pending-said'
import type { RetryDeps } from './retrying-step'
import type { ModelWaitObserver, SleepPrevention } from './loop-ports'
import { openTurnSpend, TURN_CRASHED, type TurnLedgerDeps } from '../ledger/record-turn-spend'
import {
  runFailureWith,
  type FailureDiagnostics,
  type NormalizeFailure,
} from '../model/run-failure'
import { recordEscapedFailure, recordRunFailure } from './recorded-failures'
import { appendResumeDrafts } from './resume-turn'
import { createSettlePending, type OnToolOutputNotice } from './settle-pending'
import { runTrackedTurn, type TrackedTurnDeps } from './tracked-turn'
import { ETurnStatus, type TurnOutcome } from './turn-outcome'
import { TurnRunner } from './turn-runner.port'

export type { PendingDrain }

export type TurnDeps = {
  log: EventLogPort
  logPort?: LogPort | undefined
  model: ModelPort
  ids: IdPort
  assembly: AssemblyPipeline
  tools?: (() => readonly ToolDeclaration[]) | undefined
  countTokens?: ((assembled: Assembled) => number) | undefined
  onChunk?: ChunkFilter | undefined
  onToolOutput?: OnToolOutputNotice | undefined
  onContext?: ((args: { tokens: number; window: number }) => void) | undefined
  dispatch?: ToolDispatcher | undefined
  hooks?: HookChain | undefined
  uploads?: SaidUploadsPort | undefined
  intake?: AgentIntake | undefined
  expandContext?: ExpandContext | undefined
  spend?: TurnLedgerDeps | undefined
  compact?: ((args: { threadId: ThreadId }) => Promise<boolean>) | undefined
  applyLoopCut?: ApplyLoopCut | undefined
  onLoopCut?: ((cut: LoopCut) => void) | undefined
  watchLoop?: LoopWatch | undefined
  onLoopWatch?: (() => void) | undefined
  onLoopWatchCut?: ((args: { steps: number }) => void) | undefined
  onLoopStop?: (() => void) | undefined
  autoCompactAtPercent?: (() => number) | undefined
  launchDirectory?: string | undefined
  retry?: RetryDeps | undefined
  sleepPrevention?: SleepPrevention | undefined
  waitState?: ModelWaitObserver | undefined
  normalizeFailure: NormalizeFailure
  failureDiagnostics?: FailureDiagnostics | undefined
}

export class LoopTurnRunner extends TurnRunner {
  private readonly log: EventLogPort
  private readonly model: ModelPort
  private readonly ids: IdPort
  private readonly spend: TurnLedgerDeps | undefined
  private readonly logPort: LogPort | undefined
  private readonly retry: RetryDeps | undefined
  private readonly sleepPrevention: SleepPrevention | undefined
  private readonly tracked: TrackedTurnDeps
  private readonly normalizeFailure: NormalizeFailure
  private readonly failureDiagnostics: FailureDiagnostics | undefined
  private readonly expandContext: ExpandContext | undefined

  constructor(deps: TurnDeps) {
    super()
    this.log = deps.log
    this.model = deps.model
    this.ids = deps.ids
    this.spend = deps.spend
    this.logPort = deps.logPort
    this.retry = deps.retry
    this.sleepPrevention = deps.sleepPrevention
    this.expandContext = deps.expandContext
    this.normalizeFailure = deps.normalizeFailure
    this.failureDiagnostics = deps.failureDiagnostics

    const tools = deps.tools ?? (() => [])
    const countTokens =
      deps.countTokens ??
      ((assembled: Assembled) => estimateTokensFor(imageTierOf(deps.model))(assembled))

    this.tracked = {
      log: deps.log,
      model: deps.model,
      ids: deps.ids,
      assembly: deps.assembly,
      tools,
      countTokens,
      onChunk: deps.onChunk,
      onContext: deps.onContext,
      hooks: deps.hooks,
      uploads: deps.uploads,
      intake: deps.intake,
      settlePending:
        deps.dispatch === undefined
          ? undefined
          : createSettlePending({
              log: deps.log,
              dispatch: deps.dispatch,
              tools,
              launchDirectory: deps.launchDirectory,
              onToolOutput: deps.onToolOutput,
            }),
      compact: deps.compact,
      applyLoopCut: deps.applyLoopCut,
      onLoopCut: deps.onLoopCut,
      watchLoop: deps.watchLoop,
      onLoopWatch: deps.onLoopWatch,
      onLoopWatchCut: deps.onLoopWatchCut,
      onLoopStop: deps.onLoopStop,
      autoCompactAtPercent: deps.autoCompactAtPercent ?? (() => AUTO_COMPACT_OFF),
      launchDirectory: deps.launchDirectory ?? process.cwd(),
      retry: deps.retry,
      waitState: deps.waitState,
      normalizeFailure: deps.normalizeFailure,
    }
  }

  private retryFor({ threadId }: { threadId: ThreadId }): RetryDeps | undefined {
    if (this.logPort === undefined) return this.retry
    const logPort = this.logPort
    const diagnostics = this.failureDiagnostics
    return {
      ...this.retry,
      ...(logPort === undefined
        ? {}
        : {
            log: ({ attempt, maxAttempts, reason, willRetry, error }) => {
              logPort.warn({
                source: 'loop.retry',
                message: willRetry
                  ? `model step failed (attempt ${attempt}/${maxAttempts}, ${reason}) — retrying`
                  : `model step failed (attempt ${attempt}/${maxAttempts}, ${reason}) — not retrying`,
                threadId,
                data: {
                  attempt,
                  maxAttempts,
                  reason,
                  willRetry,
                  modelError: diagnostics?.(error) ?? {},
                },
                ...logFieldsOf({ error }),
              })
            },
          }),
    }
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
    await this.log.append({
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
      log: this.log,
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
        await recordRunFailure({ log: this.log, threadId, runId, failure })
        return { ...outcome, failure }
      }
      return outcome
    } catch (error) {
      await recordEscapedFailure({
        log: this.log,
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
