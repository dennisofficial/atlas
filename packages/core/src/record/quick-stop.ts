import { EMessageOrigin, saidBy, type AssistantPart } from '../events/body'
import type { V2Event, V2EventType } from './event'
import { openTurnOf, ETurnCause, ETurnEndedBy, ETurnOutcome } from './turns'
import { visibleEvents } from './visibility'

export type QuickStop = { toSeq: number; draft: string } | null

export type QuickStopEnding = { outcome: ETurnOutcome; by: ETurnEndedBy }

const BOOKKEEPING_TYPES: ReadonlySet<V2EventType> = new Set<V2EventType>([
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

const quietRowOf = (event: V2Event): boolean => {
  if (BOOKKEEPING_TYPES.has(event.type)) return true
  return event.type === 'assistant-said' && !saysSomething(event.parts)
}

const operatorPromptOf = (event: V2Event): event is Extract<V2Event, { type: 'user-said' }> =>
  event.type === 'user-said' && saidBy(event) === EMessageOrigin.Operator

export function quickStopOf(input: {
  events: readonly V2Event[]
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
  const intake = visible.slice(previousEnd + 1, startIndex)
  if (!intake.every((event) => operatorPromptOf(event) || BOOKKEEPING_TYPES.has(event.type))) {
    return null
  }
  const prompts = intake.filter(operatorPromptOf)
  const first = prompts[0]
  if (first === undefined) return null
  if (!visible.slice(startIndex + 1).every(quietRowOf)) return null

  return { toSeq: first.seq - 1, draft: prompts.map((event) => event.text).join('\n\n') }
}
