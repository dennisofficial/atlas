import {
  callIdsIn,
  dedupeCallIds,
  type Event,
  type ModelStepResult,
  type RunId,
  type ThreadId,
} from '@dltech/atlas-core'

import { watchStepLoop, type WatchOutcome } from './loop-watchdog'
import { appendShellCompletionNudge } from './shell-completion'
import { handoffAbortedDrafts, interruptedDrafts } from './step-drafts'
import type { TrackedTurnDeps } from './tracked-turn-deps'
import { eventsForLoopWatch } from './turn-reads'
import type { TurnPosition } from './turn-position-state'

export async function recordAbandonedStep({
  deps,
  threadId,
  runId,
  result,
  events,
  seenThrough,
  stopped,
}: {
  deps: TrackedTurnDeps
  threadId: ThreadId
  runId: RunId
  result: ModelStepResult
  events: readonly Event[]
  seenThrough: number | undefined
  stopped: boolean
}): Promise<void> {
  const { record } = deps
  const abandoned = dedupeCallIds({
    drafts: interruptedDrafts({ result, model: deps.model, stopped }),
    taken: callIdsIn(events),
  })
  if (abandoned.length > 0) await record.append({ threadId, runId, drafts: abandoned })
  await appendShellCompletionNudge({ record, threadId, runId, seenThrough })
}

export async function recordHandoffAborted({
  deps,
  threadId,
  runId,
  result,
}: {
  deps: TrackedTurnDeps
  threadId: ThreadId
  runId: RunId
  result: ModelStepResult
}): Promise<void> {
  const drafts = handoffAbortedDrafts({ result, model: deps.model })
  if (drafts.length > 0) await deps.record.append({ threadId, runId, drafts })
}

export async function watchTurnStep({
  deps,
  position,
  threadId,
  runId,
  signal,
}: {
  deps: TrackedTurnDeps
  position: TurnPosition
  threadId: ThreadId
  runId: RunId
  signal: AbortSignal
}): Promise<WatchOutcome> {
  return watchStepLoop({
    watchLoop: deps.watchLoop,
    events: await eventsForLoopWatch({ deps, threadId }),
    threadId,
    runId,
    signal,
    record: deps.record,
    applyLoopCut: deps.applyLoopCut,
    onLoopWatch: deps.onLoopWatch,
    onLoopWatchCut: deps.onLoopWatchCut,
    onLoopStop: deps.onLoopStop,
    state: position.watch,
  })
}
