import { EMessageOrigin, saidBy, type AssistantPart } from '../events/body'
import type { RecordEvent, RecordEventType } from './event'
import { openTurnOf, ETurnCause, ETurnEndedBy, ETurnOutcome } from './turns'
import { visibleEvents } from './visibility'

export type QuickStop = { toSeq: number; draft: string } | null

export type QuickStopEnding = { outcome: ETurnOutcome; by: ETurnEndedBy }

const BOOKKEEPING_TYPES: ReadonlySet<RecordEventType> = new Set<RecordEventType>([
  'input-consumed',
  'input-posted',
  'retry-scheduled',
  'model-fell-back',
  'fact-recorded',
  'context-changed',
  'resource-loaded',
])

const saysSomething = (parts: readonly AssistantPart[]): boolean =>
  parts.some((part) => part.type === 'text' && part.text.length > 0)

const quietRowOf = (event: RecordEvent): boolean => {
  if (BOOKKEEPING_TYPES.has(event.type)) return true
  return event.type === 'assistant-said' && !saysSomething(event.parts)
}

const operatorPromptOf = (
  event: RecordEvent,
): event is Extract<RecordEvent, { type: 'user-said' }> =>
  event.type === 'user-said' && saidBy(event) === EMessageOrigin.Operator

export function quickStopOf(input: {
  events: readonly RecordEvent[]
  ending: QuickStopEnding
}): QuickStop {
  if (input.ending.outcome !== ETurnOutcome.Stopped) return null
  if (input.ending.by !== ETurnEndedBy.Operator) return null

  const visible = visibleEvents(input.events)
  const open = openTurnOf(visible)
  if (open === null) return null

  const startIndex = visible.findLastIndex(
    (event) => event.type === 'turn-started' && event.turnId === open.turnId,
  )
  const start = visible[startIndex]
  if (start === undefined || start.type !== 'turn-started') return null
  if (start.cause !== ETurnCause.Input) return null

  const previousEnd = visible.findLastIndex(
    (event, index) => index < startIndex && event.type === 'turn-ended',
  )
  const hidden = visible.slice(previousEnd + 1)
  const firstStep = hidden.findIndex((event) => event.type === 'assistant-said')
  const intake = firstStep < 0 ? hidden : hidden.slice(0, firstStep)
  const steps = firstStep < 0 ? [] : hidden.slice(firstStep)
  const intakeRowOf = (event: RecordEvent): boolean =>
    event === start || operatorPromptOf(event) || BOOKKEEPING_TYPES.has(event.type)
  if (!intake.every(intakeRowOf)) return null
  if (!steps.every(quietRowOf)) return null
  const prompts = intake.filter(operatorPromptOf)
  const first = prompts[0]
  if (first === undefined) return null

  return {
    toSeq: Math.min(first.seq, start.seq) - 1,
    draft: prompts.map((event) => event.text).join('\n\n'),
  }
}
