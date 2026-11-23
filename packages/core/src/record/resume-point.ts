import { EResumePoint, type ResumeDiscard } from '../events/body'
import { APPROVAL_WAITING, carriesInterruption, TOOL_PARKED_WAITING } from '../events/resume-plan'
import type { V2Event } from './event'
import { loopStateOf, openParkedCallOfState, outstandingApprovalOf } from './loop-state'
import { visibleLoopEvents } from './loop-events'
import { ETurnOutcome, openTurnOf } from './turns'
import { visibleEvents } from './visibility'

export { EResumePoint, type ResumeDiscard }

export type ResumePoint =
  | { kind: EResumePoint.Clean; discard: ResumeDiscard | null }
  | { kind: EResumePoint.ToolInterrupted; callIds: readonly string[] }
  | { kind: EResumePoint.NotResumable; because: string }

export const RESUME_REFUSAL_RUNNING = 'A turn is running; stop it first.'
export const RESUME_REFUSAL_NOTHING = 'There is no stopped turn to resume.'
export const RESUME_REFUSAL_FINISHED = 'The last turn finished; send a message to continue.'
export const RESUME_REFUSAL_FAILED = 'The last turn failed; retry it.'
export const RESUME_REFUSAL_MESSAGE = 'A message follows the stop; the turn continues from it.'
export const RESUME_REFUSAL_ALREADY = 'This turn has already been resumed.'

type TurnEndedEvent = Extract<V2Event, { type: 'turn-ended' }>
type AssistantSaidEvent = Extract<V2Event, { type: 'assistant-said' }>

const notResumable = (because: string): ResumePoint => ({
  kind: EResumePoint.NotResumable,
  because,
})

export const resumableOf = (point: ResumePoint): boolean => point.kind !== EResumePoint.NotResumable

const blockedReasonOf = (events: readonly V2Event[]): string | undefined => {
  const state = loopStateOf({ events: visibleLoopEvents(events) })
  if (outstandingApprovalOf(state) !== undefined) return APPROVAL_WAITING
  if (openParkedCallOfState(state) !== undefined) return TOOL_PARKED_WAITING
  return undefined
}

const isStepRow = (event: V2Event): boolean =>
  event.type === 'tool-called' ||
  event.type === 'tool-dispatched' ||
  event.type === 'tool-parked' ||
  event.type === 'tool-result' ||
  event.type === 'tool-denied'

const interruptedCallIds = (window: readonly V2Event[]): readonly string[] => {
  const unsettled = new Map<string, number>()
  const found: { seq: number; callId: string }[] = []
  for (const event of window) {
    if (event.type === 'tool-called') unsettled.set(event.callId, event.seq)
    if (event.type !== 'tool-result' && event.type !== 'tool-denied') continue
    unsettled.delete(event.callId)
    if (event.type === 'tool-result' && event.interrupted === true) {
      found.push({ seq: event.seq, callId: event.callId })
    }
  }
  for (const [callId, seq] of unsettled) found.push({ seq, callId })

  const seen = new Set<string>()
  return found
    .sort((left, right) => left.seq - right.seq)
    .flatMap((entry) => {
      if (seen.has(entry.callId)) return []
      seen.add(entry.callId)
      return [entry.callId]
    })
}

const discardThroughOf = (params: { window: readonly V2Event[]; cutIndex: number }): number => {
  let through = 0
  for (let index = params.cutIndex; index < params.window.length; index += 1) {
    const event = params.window[index]
    if (event === undefined) break
    if (index > params.cutIndex && !isStepRow(event)) break
    through = event.seq
  }
  return through
}

const cutPointOf = (window: readonly V2Event[]): ResumePoint => {
  const cutIndex = window.findLastIndex(
    (event): event is AssistantSaidEvent =>
      event.type === 'assistant-said' && carriesInterruption(event),
  )
  const cut = cutIndex < 0 ? undefined : window[cutIndex]
  if (cut === undefined) return { kind: EResumePoint.Clean, discard: null }

  return {
    kind: EResumePoint.Clean,
    discard: {
      fromSeq: cut.seq,
      throughSeq: discardThroughOf({ window, cutIndex }),
    },
  }
}

export function resumePointOf(input: { events: readonly V2Event[] }): ResumePoint {
  const visible = visibleEvents(input.events)
  if (openTurnOf(visible) !== null) return notResumable(RESUME_REFUSAL_RUNNING)

  const blocked = blockedReasonOf(input.events)
  if (blocked !== undefined) return notResumable(blocked)

  const ending = visible.findLast((event): event is TurnEndedEvent => event.type === 'turn-ended')
  if (ending === undefined) return notResumable(RESUME_REFUSAL_NOTHING)
  if (ending.outcome === ETurnOutcome.Completed) return notResumable(RESUME_REFUSAL_FINISHED)
  if (ending.outcome === ETurnOutcome.Failed) return notResumable(RESUME_REFUSAL_FAILED)

  const after = visible.slice(visible.indexOf(ending) + 1)
  if (after.some((event) => event.type === 'user-said')) {
    return notResumable(RESUME_REFUSAL_MESSAGE)
  }
  if (after.some((event) => event.type === 'resume-marked')) {
    return notResumable(RESUME_REFUSAL_ALREADY)
  }

  const leftOpen =
    ending.outcome === ETurnOutcome.Stopped || ending.outcome === ETurnOutcome.Interrupted
  if (!leftOpen) return notResumable(RESUME_REFUSAL_NOTHING)

  const window = visible.slice(visible.findLastIndex((event) => event.type === 'turn-started') + 1)
  const callIds = interruptedCallIds(window)
  if (callIds.length > 0) return { kind: EResumePoint.ToolInterrupted, callIds }

  return cutPointOf(window)
}
