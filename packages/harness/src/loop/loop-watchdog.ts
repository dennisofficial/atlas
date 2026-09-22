import {
  JEV_LOOP_KEY,
  JEV_LOOP_START_KEY,
  JEV_LOOP_THRESHOLD,
  jevLoopQuestions,
  loopWatchWindow,
  renderLoopWatchSteps,
  type DecisionAnswer,
  type DecisionPort,
  type Event,
  type LoopWatchStep,
} from '@dltech/atlas-core'

export enum ELoopWatch {
  Looping = 'looping',
  Clear = 'clear',
  NoVerdict = 'no-verdict',
  Unreachable = 'unreachable',
}

export type LoopVerdict = {
  verdict: ELoopWatch
  loopStartSeq?: number | undefined
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
    if (!outcome.ok) return { verdict: ELoopWatch.Unreachable }

    const noul = outcome.answers[JEV_LOOP_KEY]?.noul
    if (noul === undefined) return { verdict: ELoopWatch.Unreachable }

    if (noul < JEV_LOOP_THRESHOLD) return { verdict: ELoopWatch.Clear }

    return {
      verdict: ELoopWatch.Looping,
      loopStartSeq: loopStartOf({ answers: outcome.answers, steps }),
    }
  }
}
