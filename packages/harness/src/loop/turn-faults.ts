import {
  EMPTY_STEP_NUDGES_PER_TURN,
  emptyStepNudgeDraft,
  EFinishReason,
  silentStep,
  type CallId,
  type EventLogPort,
  type ExchangeFault,
  type LoopCut,
  type ModelStepResult,
  type RunId,
  type ThreadId,
} from '@dltech/atlas-core'

const faultLine = (fault: ExchangeFault): string =>
  `message ${fault.messageIndex}: ${fault.detail} (event ${fault.origin.eventId})`

export const stalledReport = (call: { callId: CallId; name: string }): string =>
  `dispatch left ${call.name} (${call.callId}) pending without settling it — the turn would spin forever`

export const swallowedReport = (call: { callId: CallId; name: string }): string =>
  `the turn called ${call.name} (${call.callId}) but the log no longer holds that call as pending, so it never ran — this is a harness bug, not something the model decided`

export const faultReport = (faults: readonly ExchangeFault[]): string =>
  `the assembled prompt is one Atlas must not send — ${faults.map(faultLine).join('; ')}`

const decidedFinishFault = (reason: EFinishReason): string =>
  `the model returned an empty reply — no text, no tool calls — and it did so with finish reason "${reason}", which is a decided answer to the payload rather than a dropped completion: the retry-and-nudge chain for dropped replies does not apply, and replaying the request would re-buy the same refusal. Narrow the request or split the context before retrying.`

export const finishFaultReport = (reason: EFinishReason): string =>
  reason === EFinishReason.ContentFilter
    ? 'the provider\'s safety filter ended the reply (finish reason "content-filter") — the turn cannot continue past it. Narrow or rephrase the request and retry.'
    : 'the provider ended the reply with finish reason "error" — it failed the generation after streaming began and Atlas will not read that as a completed turn. Retry, or switch the thread\'s model if it repeats.'

export const loopReport = (cut: LoopCut): string =>
  `the turn repeated identical ${cut.names.join(', ')} calls with identical results, its context was rewound past the repetition twice already, and it looped again — a turn this stuck fails rather than spins`

export const overflowReport = ({ tokens, window }: { tokens: number; window: number }): string =>
  `this conversation no longer fits the model's context window — about ${tokens.toLocaleString('en-US')} tokens against ${window.toLocaleString('en-US')}. Run /compact to replace the older turns with a summary, or raise the automatic threshold in settings.`

export type SilentOutcome =
  | { kind: 'answered' }
  | { kind: 'nudged' }
  | { kind: 'no-content' }
  | { kind: 'failed'; message: string; cause: unknown }

export async function nudgeSilentStep({
  result,
  threadId,
  runId,
  log,
  silentSteps,
}: {
  result: ModelStepResult
  threadId: ThreadId
  runId: RunId
  log: EventLogPort
  silentSteps: number
}): Promise<SilentOutcome> {
  const finish = result.finishReason
  if (finish === EFinishReason.Error || finish === EFinishReason.ContentFilter) {
    return { kind: 'failed', message: finishFaultReport(finish), cause: { finish } }
  }

  if (!silentStep(result)) return { kind: 'answered' }

  if (silentSteps + 1 > EMPTY_STEP_NUDGES_PER_TURN) {
    if (finish !== undefined && finish !== EFinishReason.Stop) {
      return { kind: 'failed', message: decidedFinishFault(finish), cause: { silentSteps: silentSteps + 1, finish } }
    }
    return { kind: 'no-content' }
  }

  await log.append({ threadId, runId, drafts: [emptyStepNudgeDraft()] })
  return { kind: 'nudged' }
}
