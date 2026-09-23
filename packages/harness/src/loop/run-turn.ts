import {
  assemble,
  AUTO_COMPACT_OFF,
  autoCompactBeforeStep,
  EAutoCompact,
  overflowsWindow,
  awaitsReply,
  callIdsIn,
  dedupeCallIds,
  estimateTokensFor,
  imageTierOf,
  toolImagesCarriedBy,
  contextWindowOf,
  exchangeFaults,
  loopCutNoticeDraft,
  loopCutPlan,
  loopCutTarget,
  loopWatchCutAllowed,
  loopWatchCutNoticeDraft,
  loopWatchNudgeDraft,
  pendingCalls,
  projectDirectoryOf,
  rowsOwnedBy,
  type Assembled,
  type LoopCut,
  type AssemblyPipeline,
  type ThreadId,
  type CallId,
  type ChunkFilter,
  type EventDraft,
  type EventLogPort,
  type IdPort,
  type ModelPort,
  type ModelToolCall,
  type RuleContext,
  type RunId,
  type ToolDeclaration,
} from '@dltech/atlas-core'

import type { HookChain } from '../hooks/registry'
import type { ApplyLoopCut } from '../store/cut-loop'
import type { ToolDispatcher } from '../tools/dispatch'
import { MAX_LOOP_CUTS_PER_TURN, repeatableFor } from './loop-guard'
import { ELoopWatch, type LoopWatch } from './loop-watchdog'
import { takeModelStepWithRetry, type RetryDeps } from './retrying-step'
import { openTurnSpend, TURN_CRASHED, type TurnLedgerDeps, type TurnSpendTally } from '../ledger/record-turn-spend'
import { appendResumeDrafts } from './resume-turn'
import { createSettlePending, type OnToolOutputNotice, type SettlePending } from './settle-pending'
import { draftsFor, interruptedDrafts } from './step-drafts'
import { faultReport, loopReport, overflowReport, stalledReport, swallowedReport } from './turn-faults'
import { committedSinceLastMessage, messageArrivedSince } from './turn-position'
import { ETurnStatus, type TurnOutcome } from './turn-outcome'
import { TurnRunner } from './turn-runner.port'

export type TurnDeps = {
  log: EventLogPort
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
    | ((args: { threadId: ThreadId }) => Promise<readonly EventDraft[]>)
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
}

export class LoopTurnRunner extends TurnRunner {
  private readonly log: EventLogPort
  private readonly model: ModelPort
  private readonly ids: IdPort
  private readonly assembly: AssemblyPipeline
  private readonly tools: () => readonly ToolDeclaration[]
  private readonly countTokens: (assembled: Assembled) => number
  private readonly onChunk: ChunkFilter | undefined
  private readonly onContext: ((args: { tokens: number; window: number }) => void) | undefined
  private readonly hooks: HookChain | undefined
  private readonly drainPending:
    | ((args: { threadId: ThreadId }) => Promise<readonly EventDraft[]>)
    | undefined
  private readonly spend: TurnLedgerDeps | undefined
  private readonly settlePending: SettlePending | undefined
  private readonly compact: ((args: { threadId: ThreadId }) => Promise<boolean>) | undefined
  private readonly applyLoopCut: ApplyLoopCut | undefined
  private readonly onLoopCut: ((cut: LoopCut) => void) | undefined
  private readonly watchLoop: LoopWatch | undefined
  private readonly onLoopWatch: (() => void) | undefined
  private readonly onLoopWatchCut: ((args: { steps: number }) => void) | undefined
  private readonly onLoopStop: (() => void) | undefined
  private readonly autoCompactAtPercent: () => number
  private readonly launchDirectory: string
  private readonly retry: RetryDeps | undefined

  constructor(deps: TurnDeps) {
    super()
    this.log = deps.log
    this.model = deps.model
    this.ids = deps.ids
    this.assembly = deps.assembly
    this.tools = deps.tools ?? (() => [])
    this.countTokens =
      deps.countTokens ??
      ((assembled) =>
        estimateTokensFor({
          tier: imageTierOf(this.model),
          carriesToolImages: toolImagesCarriedBy(this.model),
        })(assembled))
    this.onChunk = deps.onChunk
    this.onContext = deps.onContext
    this.hooks = deps.hooks
    this.drainPending = deps.drainPending
    this.spend = deps.spend
    this.compact = deps.compact
    this.applyLoopCut = deps.applyLoopCut
    this.onLoopCut = deps.onLoopCut
    this.watchLoop = deps.watchLoop
    this.onLoopWatch = deps.onLoopWatch
    this.onLoopWatchCut = deps.onLoopWatchCut
    this.onLoopStop = deps.onLoopStop
    this.autoCompactAtPercent = deps.autoCompactAtPercent ?? (() => AUTO_COMPACT_OFF)
    this.launchDirectory = deps.launchDirectory ?? process.cwd()
    this.retry = deps.retry
    this.settlePending =
      deps.dispatch === undefined
        ? undefined
        : createSettlePending({
            log: deps.log,
            dispatch: deps.dispatch,
            tools: this.tools,
            launchDirectory: deps.launchDirectory,
            onToolOutput: deps.onToolOutput,
          })
  }

  async say({
    threadId,
    text,
    signal,
  }: {
    threadId: ThreadId
    text: string
    signal?: AbortSignal
  }): Promise<TurnOutcome> {
    await this.log.append({
      threadId,
      runId: this.ids.nextRunId(),
      drafts: [{ type: 'user-said', text }],
    })
    return this.runTurn({ threadId, ...(signal === undefined ? {} : { signal }) })
  }

  async resume({ threadId, signal }: { threadId: ThreadId; signal?: AbortSignal }): Promise<TurnOutcome> {
    await appendResumeDrafts({ log: this.log, ids: this.ids, threadId })
    return this.runTurn({ threadId, ...(signal === undefined ? {} : { signal }) })
  }

  async runTurn({ threadId, signal }: { threadId: ThreadId; signal?: AbortSignal }): Promise<TurnOutcome> {
    const runId = this.ids.nextRunId()
    const spend = openTurnSpend({ ...(this.spend ?? {}), model: this.model.identity })
    let status: string = TURN_CRASHED

    try {
      const outcome = await this.trackedTurn({
        threadId,
        runId,
        spend,
        ...(signal === undefined ? {} : { signal }),
      })
      status = outcome.status
      return outcome
    } finally {
      await spend.settle({ threadId, runId, status })
    }
  }

  private async drainInto({ threadId }: { threadId: ThreadId }): Promise<boolean> {
    if (this.drainPending === undefined) return false

    const waiting = await this.drainPending({ threadId })
    if (waiting.length === 0) return false

    await this.log.append({ threadId, runId: this.ids.nextRunId(), drafts: waiting })
    return true
  }

  private async trackedTurn({
    threadId,
    signal,
    runId,
    spend,
  }: {
    threadId: ThreadId
    signal?: AbortSignal
    runId: RunId
    spend: TurnSpendTally
  }): Promise<TurnOutcome> {
    const abortSignal = signal ?? new AbortController().signal
    let previous: Assembled | undefined
    let modelSteps = 0
    let seenThrough: number | undefined
    let settleAttempted: CallId | undefined
    let compacted = false
    let loopCuts = 0
    let loopWatchWarned = false
    const loopWatchCutAnchors: number[] = []
    const committedCalls: ModelToolCall[] = []

    const interrupted = async (): Promise<TurnOutcome> => ({
      status: ETurnStatus.Interrupted,
      runId,
      committed: committedSinceLastMessage(
        rowsOwnedBy({ events: await this.log.read({ threadId }), threadId }),
      ),
    })

    const projectDirectory = projectDirectoryOf({
      events: await this.log.read({ threadId }),
      launchDirectory: this.launchDirectory,
    })

    const opening = (await this.hooks?.beforeTurn({ threadId, projectDirectory })) ?? []
    if (opening.length > 0) await this.log.append({ threadId, runId, drafts: opening })

    for (;;) {
      const beforeDrain = await this.log.read({ threadId })
      const ownedBeforeDrain = rowsOwnedBy({ events: beforeDrain, threadId })

      const pending = pendingCalls(ownedBeforeDrain)[0]
      const settlePending = this.settlePending
      if (pending !== undefined) {
        if (settlePending === undefined) {
          return { status: ETurnStatus.Paused, runId, callId: pending.callId, reason: `awaiting ${pending.name}` }
        }
        if (pending.callId === settleAttempted) {
          return { status: ETurnStatus.Failed, runId, message: stalledReport(pending), cause: pending }
        }

        settleAttempted = pending.callId
        const settled = await settlePending({ threadId, signal: abortSignal })
        if (settled.paused !== undefined) return { status: ETurnStatus.Paused, runId, ...settled.paused }
        if (abortSignal.aborted) return interrupted()
        continue
      }

      const events = (await this.drainInto({ threadId })) ? await this.log.read({ threadId }) : beforeDrain
      const owned = rowsOwnedBy({ events, threadId })

      if (this.applyLoopCut !== undefined) {
        const cut = loopCutPlan({
          events: owned,
          repeatable: repeatableFor({ tools: this.tools, projectDirectory }),
        })
        if (cut !== undefined) {
          if (loopCuts >= MAX_LOOP_CUTS_PER_TURN) {
            return { status: ETurnStatus.Failed, runId, message: loopReport(cut), cause: cut }
          }
          loopCuts += 1
          const applied = await this.applyLoopCut({
            threadId,
            toSeq: cut.toSeq,
            throughSeq: cut.throughSeq,
            notice: loopCutNoticeDraft(cut),
          })
          if (applied) {
            this.onLoopCut?.(cut)
            previous = undefined
            seenThrough = undefined
            continue
          }
        }
      }

      if (!awaitsReply(owned) && !messageArrivedSince({ events: owned, seenThrough })) {
        const swallowed = committedCalls.at(-1)
        if (swallowed !== undefined) {
          return { status: ETurnStatus.Failed, runId, message: swallowedReport(swallowed), cause: swallowed }
        }
        return { status: ETurnStatus.Idle, runId }
      }

      if (this.watchLoop !== undefined && !abortSignal.aborted) {
        const watch = await this.watchLoop({ events: owned, signal: abortSignal })
        if (watch.verdict === ELoopWatch.Looping) {
          const throughSeq = owned.at(-1)?.seq
          const target =
            watch.loopStartSeq === undefined || throughSeq === undefined
              ? undefined
              : loopCutTarget({ events: owned, seq: watch.loopStartSeq })
          if (
            target !== undefined &&
            throughSeq !== undefined &&
            this.applyLoopCut !== undefined &&
            loopWatchCutAllowed({ previous: loopWatchCutAnchors, anchor: target })
          ) {
            const applied = await this.applyLoopCut({
              threadId,
              toSeq: target,
              throughSeq,
              notice: loopWatchCutNoticeDraft({ steps: throughSeq - target }),
            })
            if (applied) {
              loopWatchCutAnchors.push(target)
              this.onLoopWatchCut?.({ steps: throughSeq - target })
              previous = undefined
              seenThrough = undefined
              continue
            }
          }
          if (loopWatchWarned) {
            this.onLoopStop?.()
            return { status: ETurnStatus.Idle, runId }
          }
          loopWatchWarned = true
          await this.log.append({ threadId, runId, drafts: [loopWatchNudgeDraft()] })
          this.onLoopWatch?.()
          previous = undefined
          seenThrough = undefined
          continue
        }
        if (watch.verdict === ELoopWatch.Clear) {
          loopWatchWarned = false
          loopWatchCutAnchors.length = 0
        }
      }

      seenThrough = owned.at(-1)?.seq

      const ctx: RuleContext = {
        events,
        threadId,
        step: modelSteps,
        provider: this.model.identity,
        countTokens: this.countTokens,
        ...(previous === undefined ? {} : { previous }),
      }

      const { assembled: projected, trace } = assemble({
        rules: this.assembly.rules,
        annotators: this.assembly.annotators,
        ctx,
      })

      const assembled = (await this.hooks?.beforeStep({ assembled: projected, trace })) ?? projected
      previous = assembled

      const tokens = this.countTokens(assembled)
      const window = contextWindowOf(this.model)
      this.onContext?.({ tokens, window })

      if (
        autoCompactBeforeStep({ tokens, window, atPercent: this.autoCompactAtPercent() }) ===
          EAutoCompact.BeforeOverflow &&
        !compacted &&
        this.compact !== undefined
      ) {
        compacted = true
        if (await this.compact({ threadId })) {
          previous = undefined
          continue
        }
      }

      if (overflowsWindow({ tokens, window })) {
        return {
          status: ETurnStatus.Failed,
          runId,
          message: overflowReport({ tokens, window }),
          cause: { tokens, window },
        }
      }

      const faults = exchangeFaults(assembled)
      if (faults.length > 0) {
        return { status: ETurnStatus.Failed, runId, message: faultReport(faults), cause: faults }
      }

      const stepped = await takeModelStepWithRetry({
        model: this.model,
        tools: this.tools(),
        onChunk: this.onChunk,
        assembled,
        signal: abortSignal,
        retry: this.retry,
      })

      modelSteps += 1
      settleAttempted = undefined

      spend.countStep(stepped.ok ? stepped.result.usage : undefined)

      if (!stepped.ok) {
        return { status: ETurnStatus.Failed, runId, message: stepped.message, cause: stepped.cause }
      }

      if (abortSignal.aborted) {
        const abandoned = dedupeCallIds({
          drafts: interruptedDrafts(stepped.result),
          taken: callIdsIn(events),
        })
        if (abandoned.length > 0) await this.log.append({ threadId, runId, drafts: abandoned })
        return interrupted()
      }

      const drafts = dedupeCallIds({ drafts: draftsFor(stepped.result), taken: callIdsIn(events) })
      if (drafts.length > 0) await this.log.append({ threadId, runId, drafts })

      committedCalls.push(...stepped.result.toolCalls)
      if (stepped.result.toolCalls.length > 0) continue

      const latest = await this.log.read({ threadId })
      if (messageArrivedSince({ events: latest, seenThrough })) continue
      if (await this.drainInto({ threadId })) continue

      const closing = (await this.hooks?.afterTurn({ threadId })) ?? []
      if (closing.length > 0) await this.log.append({ threadId, runId, drafts: closing })

      return { status: ETurnStatus.Completed, runId }
    }
  }
}
