import {
  JEV_LOOP_KEY,
  JEV_LOOP_START_KEY,
  JEV_LOOP_THRESHOLD,
  jevLoopQuestions,
  loopCutTarget,
  loopWatchCutAllowed,
  loopWatchCutNoticeDraft,
  loopWatchNudgeDraft,
  loopWatchWindow,
  renderLoopWatchSteps,
  type DecisionAnswer,
  type DecisionPort,
  type Event,
  type EventDraft,
  type EventLogPort,
  type LoopWatchStep,
  type RunId,
  type ThreadId,
} from '@dltech/atlas-core'

import type { ApplyLoopCut } from '../store/sessions/ops/cut-loop'

export enum ELoopWatch {
  Looping = 'looping',
  Clear = 'clear',
  NoVerdict = 'no-verdict',
  Unreachable = 'unreachable',
}

export type LoopVerdict = {
  verdict: ELoopWatch
  loopStartSeq?: number | undefined
  noul?: number | undefined
  fault?: string | undefined
}

export type LoopWatch = (args: {
  events: readonly Event[]
  signal: AbortSignal
}) => Promise<LoopVerdict>

const loopStartOf = ({
  answers,
  steps,
}: {
  answers: Record<string, DecisionAnswer>
  steps: readonly LoopWatchStep[]
}): number | undefined => {
  const choice = answers[JEV_LOOP_START_KEY]?.choice
  if (choice === undefined) return undefined
  const match = /(\d+)/.exec(choice)
  if (match?.[1] === undefined) return undefined
  const seq = Number(match[1])
  return steps.some((step) => step.seq === seq) ? seq : undefined
}

/**
 * The semantic counterpart to the syntactic loop guard: the guard can only cut identical calls
 * with identical results, so a loop that rewords each round — the deploy-verify-again shape —
 * is invisible to it. jev is cheap enough to ask once per model step, and to point at the step
 * where the loop began so the caller can cut it; anything it cannot judge (unreachable,
 * malformed answer) fails open as Clear, while a window too small to judge is NoVerdict so the
 * caller leaves any escalation from an earlier warning untouched.
 */
export function jevLoopWatch(args: {
  decisions: DecisionPort
  enabled: () => boolean
}): LoopWatch {
  return async ({ events, signal }) => {
    if (!args.enabled()) return { verdict: ELoopWatch.Clear }

    const steps = loopWatchWindow({ events })
    if (steps === undefined) return { verdict: ELoopWatch.NoVerdict }

    const outcome = await args.decisions.decide({
      state: renderLoopWatchSteps({ steps }),
      questions: jevLoopQuestions({ steps }),
      signal,
    })
    if (!outcome.ok) return { verdict: ELoopWatch.Unreachable, fault: outcome.fault }

    const noul = outcome.answers[JEV_LOOP_KEY]?.noul
    if (noul === undefined) {
      return { verdict: ELoopWatch.Unreachable, fault: 'the decision model gave no loop probability' }
    }

    if (noul < JEV_LOOP_THRESHOLD) return { verdict: ELoopWatch.Clear, noul }

    return {
      verdict: ELoopWatch.Looping,
      loopStartSeq: loopStartOf({ answers: outcome.answers, steps }),
      noul,
    }
  }
}

export type WatchState = {
  warned: boolean
  cutAnchors: number[]
}

export type WatchOutcome =
  | { kind: 'step' }
  | { kind: 'rewind' }
  | { kind: 'stop' }

/**
 * One watchdog consultation of the owned log: record the verdict, cut the loop the verdict
 * points at when a cut is still allowed, warn once and stop the turn when it loops again.
 * `step` leaves the turn to its next model call; `rewind` restarts the iteration from a
 * re-read log; `stop` ends it Idle.
 */
export async function watchStepLoop({
  watchLoop,
  events,
  threadId,
  runId,
  signal,
  log,
  applyLoopCut,
  onLoopWatch,
  onLoopWatchCut,
  onLoopStop,
  state,
}: {
  watchLoop: LoopWatch | undefined
  events: readonly Event[]
  threadId: ThreadId
  runId: RunId
  signal: AbortSignal
  log: EventLogPort
  applyLoopCut: ApplyLoopCut | undefined
  onLoopWatch: (() => void) | undefined
  onLoopWatchCut: ((args: { steps: number }) => void) | undefined
  onLoopStop: (() => void) | undefined
  state: WatchState
}): Promise<WatchOutcome> {
  if (watchLoop === undefined || signal.aborted) return { kind: 'step' }

  const watch = await watchLoop({ events, signal })
  if (watch.verdict !== ELoopWatch.NoVerdict && (watch.noul !== undefined || watch.fault !== undefined)) {
    const judged: EventDraft = {
      type: 'loop-watch-verdict',
      consulted: true,
      looping: watch.verdict === ELoopWatch.Looping,
      steps: events.length,
      ...(watch.noul === undefined ? {} : { probability: watch.noul }),
      ...(watch.loopStartSeq === undefined ? {} : { loopStartSeq: watch.loopStartSeq }),
      ...(watch.fault === undefined ? {} : { fault: watch.fault }),
    }
    await log.append({ threadId, runId, drafts: [judged] })
  }

  if (watch.verdict === ELoopWatch.Clear) {
    state.warned = false
    state.cutAnchors.length = 0
    return { kind: 'step' }
  }

  if (watch.verdict !== ELoopWatch.Looping) return { kind: 'step' }

  const throughSeq = events.at(-1)?.seq
  const target =
    watch.loopStartSeq === undefined || throughSeq === undefined
      ? undefined
      : loopCutTarget({ events, seq: watch.loopStartSeq })
  if (
    target !== undefined &&
    throughSeq !== undefined &&
    applyLoopCut !== undefined &&
    loopWatchCutAllowed({ previous: state.cutAnchors, anchor: target })
  ) {
    const applied = await applyLoopCut({
      threadId,
      toSeq: target,
      throughSeq,
      notice: loopWatchCutNoticeDraft({ steps: throughSeq - target }),
    })
    if (applied) {
      state.cutAnchors.push(target)
      onLoopWatchCut?.({ steps: throughSeq - target })
      return { kind: 'rewind' }
    }
  }

  if (state.warned) {
    onLoopStop?.()
    return { kind: 'stop' }
  }

  state.warned = true
  await log.append({ threadId, runId, drafts: [loopWatchNudgeDraft()] })
  onLoopWatch?.()
  return { kind: 'rewind' }
}
