import type { ModelPort, ThreadId } from '@dltech/atlas-core'
import {
  ESpan,
  spanWith,
  type ETurnEntry,
  type SpanFields,
  type TracePort,
} from '@dltech/atlas-observability'

import type { AgentIntake } from '../intake/agent-intake'
import { FirstTokenClock } from './first-token'
import { turnWaitOf } from './turn-wait'
import type { LoopWatch } from '../loop/loop-watchdog'
import { sleepUnlessAborted, type RetryDeps } from '../loop/retrying-step'
import type { TurnDeps } from '../loop/run-turn'
import { ETurnStatus, type TurnOutcome } from '../loop/turn-outcome'
import { TracedModel } from './traced-model'
import { TracedRecord } from './traced-record'
import type { AgentRecordPort } from '../record/agent-record.port'

const tracedIntake = ({
  intake,
  trace,
}: {
  intake: AgentIntake
  trace: TracePort
}): AgentIntake => {
  const subscribe = intake.subscribe?.bind(intake)
  return {
    prepare: (args) =>
      trace.span({
        name: ESpan.StepIntake,
        fields: { threadId: args.threadId },
        run: async (span) => {
          const drain = await intake.prepare(args)
          span.set({ drafts: drain.drafts.length })
          return drain
        },
      }),
    ...(subscribe === undefined ? {} : { subscribe }),
  }
}

const tracedLoopWatch =
  ({ watch, trace }: { watch: LoopWatch; trace: TracePort }): LoopWatch =>
  (args) =>
    trace.span({
      name: ESpan.LoopWatch,
      run: async (span) => {
        const verdict = await watch(args)
        span.set({ verdict: verdict.verdict })
        return verdict
      },
    })

const tracedRetry = ({
  retry,
  trace,
}: {
  retry: RetryDeps | undefined
  trace: TracePort
}): RetryDeps => {
  const sleep = retry?.sleep ?? sleepUnlessAborted
  return {
    ...retry,
    sleep: (args) =>
      trace.span({
        name: ESpan.ModelBackoff,
        fields: { delayMs: args.ms },
        run: () => sleep(args),
      }),
  }
}

/** Wraps the loop's collaborators so every model call, read, append, drain and watch is a span. */
export function tracedTurnDeps(deps: TurnDeps): TurnDeps {
  const { trace } = deps
  if (trace === undefined) return deps
  const firstToken = new FirstTokenClock()
  return {
    ...deps,
    firstToken,
    record: new TracedRecord({ inner: deps.record, trace }),
    model: new TracedModel({ inner: deps.model, trace, firstToken }),
    retry: tracedRetry({ retry: deps.retry, trace }),
    ...(deps.intake === undefined ? {} : { intake: tracedIntake({ intake: deps.intake, trace }) }),
    ...(deps.watchLoop === undefined
      ? {}
      : { watchLoop: tracedLoopWatch({ watch: deps.watchLoop, trace }) }),
  }
}

export const traceTurn = async (args: {
  trace: TracePort | undefined
  model: ModelPort
  record: AgentRecordPort
  threadId: ThreadId
  entry: ETurnEntry
  firstToken?: FirstTokenClock | undefined
  run: () => Promise<TurnOutcome>
}): Promise<TurnOutcome> => {
  const wait =
    args.trace === undefined
      ? undefined
      : await turnWaitOf({
          record: args.record,
          threadId: args.threadId,
          now: Date.now(),
        })
  const fields: SpanFields = {
    threadId: args.threadId,
    entry: args.entry,
    provider: args.model.identity.id,
    model: args.model.identity.modelId,
    ...wait?.fields,
  }
  return spanWith(args.trace, {
    name: ESpan.Turn,
    root: true,
    fields,
    run: async (span) => {
      args.firstToken?.arm({ span, promptAt: wait?.promptAt })
      try {
        const outcome = await args.run()
        span.set({
          runId: outcome.runId,
          status: outcome.status,
          ...(outcome.status === ETurnStatus.Failed && outcome.failure !== undefined
            ? { failureKind: outcome.failure.kind }
            : {}),
        })
        return outcome
      } finally {
        args.firstToken?.disarm()
      }
    },
  })
}
