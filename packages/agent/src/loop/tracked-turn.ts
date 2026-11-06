import {
  awaitsReplyOf,
  callIdsIn,
  dedupeCallIds,
  EMPTY_STEP_RAW_RETRIES,
  pendingCallsOf,
  projectDirectoryOfState,
  retriableEmptyStep,
  type ThreadId,
  type RunId,
} from '@dltech/atlas-core'

import { ESpan, spanWith } from '@dltech/atlas-observability'

import { guardRepeatLoop } from './loop-guard'
import type { PauseSignal } from './pause-signal'
import { appendPending } from './pending-intake'
import { takeModelStepWithRetry } from './retrying-step'
import { stepRetryDeps } from './step-retry-deps'
import { stepStreamerFor } from './streamed-chunks'
import type { TurnSpendTally } from '../ledger/record-turn-spend'
import { recordAbandonedStep, watchTurnStep } from './turn-step-helpers'
import { draftsFor } from './step-drafts'
import { prepareStepAssembly, stepPrepareDepsOf, preparedFailureMessage } from './step-prepare'
import { idleOrSwallowed } from './swallowed-outcome'
import { waitingIfBlocked } from './waiting-outcome'
import { messageArrivedAfter, settlePendingCall } from './turn-position'
import { committedSinceLastPrompt, swallowedSince, tailForLoopGuard } from './turn-reads'
import { ETurnStatus, type TurnOutcome } from './turn-outcome'
import { closeQuietStep } from './close-quiet-step'
import { openPosition } from './turn-position-state'
import type { TrackedTurnDeps } from './tracked-turn-deps'

export type { TrackedTurnDeps } from './tracked-turn-deps'

export async function runTrackedTurn(
  deps: TrackedTurnDeps,
  {
    threadId,
    signal,
    pause,
    runId,
    spend,
  }: {
    threadId: ThreadId
    signal?: AbortSignal
    pause?: PauseSignal
    runId: RunId
    spend: TurnSpendTally
  },
): Promise<TurnOutcome> {
  const { record, ids } = deps
  const abortSignal = signal ?? new AbortController().signal
  const position = openPosition()
  const preparedAssembly = stepPrepareDepsOf({ deps, position })

  const interrupted = async (): Promise<TurnOutcome> => ({
    status: ETurnStatus.Interrupted,
    runId,
    committed: await committedSinceLastPrompt({ record, threadId }),
  })

  const opened = await record.loopState({ threadId })
  const turnStartSeq = opened.lastSeq ?? 0
  const projectDirectory = projectDirectoryOfState({
    state: opened,
    launchDirectory: deps.launchDirectory,
  })

  const opening = await spanWith(deps.trace, {
    name: ESpan.TurnHooks,
    run: async () => (await deps.hooks?.beforeTurn({ threadId, projectDirectory })) ?? [],
  })
  if (opening.length > 0) await record.append({ threadId, runId, drafts: opening })

  for (;;) {
    if (pause?.paused === true) return { status: ETurnStatus.HandoffPaused, runId }

    const beforeDrain = await record.composedEvents({ threadId })
    const before = await record.loopState({ threadId })
    const pendingBeforeDrain = pendingCallsOf(before)[0]

    const settled = await settlePendingCall({
      pending: pendingBeforeDrain,
      threadId,
      settlePending: deps.settlePending,
      settleAttempted: position.settleAttempted,
      signal: abortSignal,
    })
    if (settled.kind === 'paused')
      return { status: ETurnStatus.Paused, runId, callId: settled.callId, reason: settled.reason }
    if (settled.kind === 'stalled') {
      return { status: ETurnStatus.Failed, runId, message: settled.message, cause: settled.cause }
    }
    if (settled.kind === 'interrupted') return interrupted()
    if (settled.kind === 'settled') {
      position.settleAttempted = pendingBeforeDrain?.callId
      continue
    }

    const intake = await appendPending({
      intake: deps.intake,
      record,
      ids,
      threadId,
      signal: abortSignal,
    })
    if (!intake.ok) {
      if (abortSignal.aborted) return interrupted()
      throw intake.cause
    }
    const changed = intake.drained || intake.wakesTurn
    const events = changed ? await record.composedEvents({ threadId }) : beforeDrain
    const state = changed ? await record.loopState({ threadId }) : before

    const guarded = await guardRepeatLoop({
      events: await tailForLoopGuard({ deps, threadId, state }),
      threadId,
      tools: deps.tools,
      projectDirectory,
      applyLoopCut: deps.applyLoopCut,
      onLoopCut: deps.onLoopCut,
      loopCuts: position.loopCuts,
    })
    if (guarded.kind === 'failed') {
      return { status: ETurnStatus.Failed, runId, message: guarded.message, cause: guarded.cause }
    }
    if (guarded.kind === 'cut') {
      position.loopCuts += 1
      position.resetAssembly()
      continue
    }

    if (
      !awaitsReplyOf(state) &&
      !(await messageArrivedAfter({ record, threadId, seenThrough: position.seenThrough }))
    ) {
      return idleOrSwallowed({
        swallowed: await swallowedSince({
          record,
          threadId,
          turnStartSeq,
          committed: position.committedCalls,
        }),
        runId,
      })
    }

    const watched = await watchTurnStep({ deps, position, threadId, runId, signal: abortSignal })
    if (watched.kind === 'stop') return { status: ETurnStatus.Idle, runId }
    if (watched.kind === 'rewind') {
      position.resetAssembly()
      continue
    }

    position.seenThrough = state.lastSeq
    const stepBase = state.lastAssistant?.seq ?? 0
    let preparedThrough = position.seenThrough

    const prepareAttempt = async () => {
      const retryIntake = await appendPending({
        intake: deps.intake,
        record,
        ids,
        threadId,
        signal: abortSignal,
      })
      if (!retryIntake.ok) throw retryIntake.cause
      preparedThrough = (await record.loopState({ threadId })).lastSeq
      const prepared = await prepareStepAssembly(preparedAssembly, {
        threadId,
        events: (await deps.modelContext.read({ threadId })).events,
        step: position.modelSteps,
        previous: undefined,
        signal: abortSignal,
      })
      if (prepared.ok && 'assembled' in prepared) position.previous = prepared.assembled
      return prepared
    }

    const prepared = await prepareStepAssembly(preparedAssembly, {
      threadId,
      events: (await deps.modelContext.read({ threadId })).events,
      step: position.modelSteps,
      previous: position.previous,
      signal: abortSignal,
    })
    if (!prepared.ok) {
      const { message, cause } = preparedFailureMessage(prepared)
      return { status: ETurnStatus.Failed, runId, message, cause }
    }
    if ('compacted' in prepared) {
      position.previous = undefined
      continue
    }

    const assembled = prepared.assembled
    position.previous = assembled

    const stream = stepStreamerFor({ output: deps.streamOutput, runId, step: position.modelSteps })

    const stepOnce = () =>
      takeModelStepWithRetry({
        model: deps.model,
        tools: deps.tools(),
        onChunk: deps.onChunk,
        streamer: stream,
        assembled,
        signal: abortSignal,
        retry: stepRetryDeps({
          retry: deps.retry,
          onceLedger: deps.onceLedger,
          threadId,
          stepBase,
        }),
        normalizeFailure: deps.normalizeFailure,
        prepare: prepareAttempt,
      })

    let stepped = await stepOnce()
    const denied = await waitingIfBlocked({ deps, stepped, threadId, runId })
    if (denied !== undefined) return denied
    position.modelSteps += 1

    if (
      stepped.ok &&
      position.silentRetries < EMPTY_STEP_RAW_RETRIES &&
      retriableEmptyStep(stepped.result)
    ) {
      position.silentRetries += 1
      spend.countStep(stepped.result.usage)
      stepped = await stepOnce()
      const deniedRetry = await waitingIfBlocked({ deps, stepped, threadId, runId })
      if (deniedRetry !== undefined) return deniedRetry
    }

    position.settleAttempted = undefined
    if (stepped.ok && preparedThrough !== position.seenThrough) {
      position.previous = undefined
      position.seenThrough = preparedThrough
    }

    spend.countStep(stepped.ok ? stepped.result.usage : undefined)

    if (!stepped.ok) {
      return { status: ETurnStatus.Failed, runId, message: stepped.message, cause: stepped.cause }
    }
    await deps.waitState?.admitted({ threadId })

    if (abortSignal.aborted) {
      await recordAbandonedStep({
        deps,
        threadId,
        runId,
        result: stepped.result,
        events,
        seenThrough: position.seenThrough,
      })
      return interrupted()
    }

    const step = { result: stepped.result, model: deps.model }
    const drafts = dedupeCallIds({ drafts: draftsFor(step), taken: callIdsIn(events) })
    if (drafts.length > 0) await record.append({ threadId, runId, drafts })

    for (const draft of drafts) {
      if (draft.type === 'tool-called')
        position.committedCalls.push({ callId: draft.callId, name: draft.name })
    }
    if (stepped.result.toolCalls.length > 0) {
      position.silentSteps = 0
      position.silentRetries = 0
      continue
    }

    const quiet = await closeQuietStep({
      deps,
      position,
      stepped: stepped.result,
      threadId,
      runId,
      signal: abortSignal,
      interrupted,
    })
    if (quiet.kind === 'continue') continue
    return quiet.outcome
  }
}
