import {
  AUTO_COMPACT_OFF,
  estimateTokensFor,
  imageCostOf,
  saidBody,
  type Assembled,
  type AssemblyPipeline,
  type ThreadId,
  type ChunkFilter,
  type EventDraft,
  type EventLogPort,
  type SaidFile,
  type SaidImage,
  type IdPort,
  type LogPort,
  type LoopCut,
  type ModelPort,
  type ToolDeclaration,
} from '@dltech/atlas-core'

import { logFieldsOf } from '../store/logs'
import type { HookChain } from '../hooks/registry'
import type { ApplyLoopCut } from '../store/sessions/ops/cut-loop'
import type { ToolDispatcher } from '../tools/dispatch'
import type { LoopWatch } from './loop-watchdog'
import type { PauseSignal } from './pause-signal'
import type { PendingDrain } from './pending-intake'
import type { RetryDeps } from './retrying-step'
import type { SleepPrevention } from '../power/sleep-prevention'
import { openTurnSpend, TURN_CRASHED, type TurnLedgerDeps } from '../ledger/record-turn-spend'
import { appendResumeDrafts } from './resume-turn'
import { createSettlePending, type OnToolOutputNotice } from './settle-pending'
import { runTrackedTurn, type TrackedTurnDeps } from './tracked-turn'
import type { TurnOutcome } from './turn-outcome'
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
  drainPending?:
    | ((args: { threadId: ThreadId }) => Promise<PendingDrain>)
    | undefined
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

  constructor(deps: TurnDeps) {
    super()
    this.log = deps.log
    this.model = deps.model
    this.ids = deps.ids
    this.spend = deps.spend
    this.logPort = deps.logPort
    this.retry = deps.retry
    this.sleepPrevention = deps.sleepPrevention

    const tools = deps.tools ?? (() => [])
    const countTokens =
      deps.countTokens ?? ((assembled: Assembled) => estimateTokensFor(imageCostOf(deps.model))(assembled))

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
      drainPending: deps.drainPending,
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
    }
  }

  private retryFor({ threadId }: { threadId: ThreadId }): RetryDeps | undefined {
    if (this.logPort === undefined) return this.retry
    const logPort = this.logPort
    return {
      ...this.retry,
      log: ({ attempt, maxAttempts, reason, willRetry, error }) => {
        logPort.warn({
          source: 'loop.retry',
          message: willRetry
            ? `model step failed (attempt ${attempt}/${maxAttempts}, ${reason}) — retrying`
            : `model step failed (attempt ${attempt}/${maxAttempts}, ${reason}) — not retrying`,
          threadId,
          data: { attempt, maxAttempts, reason, willRetry },
          ...logFieldsOf({ error }),
        })
      },
    }
  }

  async say({
    threadId,
    text,
    images,
    files,
    context,
    signal,
    pause,
  }: {
    threadId: ThreadId
    text: string
    images?: readonly SaidImage[]
    files?: readonly SaidFile[]
    context?: readonly EventDraft[]
    signal?: AbortSignal
    pause?: PauseSignal
  }): Promise<TurnOutcome> {
    await this.log.append({
      threadId,
      runId: this.ids.nextRunId(),
      drafts: [
        ...(context ?? []),
        saidBody({ text, images, files }),
      ],
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
    await appendResumeDrafts({ log: this.log, ids: this.ids, threadId })
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
      return outcome
    } finally {
      releaseSleepAssertion?.()
      await spend.settle({ threadId, runId, status })
    }
  }
}
