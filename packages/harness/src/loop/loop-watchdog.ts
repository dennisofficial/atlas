import {
  JEV_LOOP_KEY,
  JEV_LOOP_THRESHOLD,
  jevLoopQuestions,
  loopWatchState,
  type DecisionPort,
  type Event,
} from '@dltech/atlas-core'

export enum ELoopWatch {
  Looping = 'looping',
  Clear = 'clear',
  Unreachable = 'unreachable',
}

export type LoopWatch = (args: {
  events: readonly Event[]
  signal: AbortSignal
}) => Promise<ELoopWatch>

/**
 * The semantic counterpart to the syntactic loop guard: the guard can only cut identical calls
 * with identical results, so a loop that rewords each round — the deploy-verify-again shape —
 * is invisible to it. jev is cheap enough to ask once per model step; anything it cannot judge
 * (short window, unreachable, malformed answer) fails open as Clear.
 */
export function jevLoopWatch(args: {
  decisions: DecisionPort
  enabled: () => boolean
}): LoopWatch {
  return async ({ events, signal }) => {
    if (!args.enabled()) return ELoopWatch.Clear

    const state = loopWatchState({ events })
    if (state === undefined) return ELoopWatch.Clear

    const outcome = await args.decisions.decide({ state, questions: jevLoopQuestions(), signal })
    if (!outcome.ok) return ELoopWatch.Unreachable

    const noul = outcome.answers[JEV_LOOP_KEY]?.noul
    if (noul === undefined) return ELoopWatch.Unreachable

    return noul >= JEV_LOOP_THRESHOLD ? ELoopWatch.Looping : ELoopWatch.Clear
  }
}
