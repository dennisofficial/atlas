import type { EventDraft } from '../events/body'
import { isNoticeArrival } from '../events/notice-stage'
import { reportWakesParent } from './report'

export const TEAMMATE_AGENT_TYPE = 'teammate'

export const isTeammateType = (agentType: string): boolean => agentType === TEAMMATE_AGENT_TYPE

/** Whether the event hands the turn to the assistant — the one projection run-turn and resume read. */
export const isTurnTaking = (event: EventDraft): boolean => {
  if (isNoticeArrival(event)) return false
  switch (event.type) {
    case 'user-said':
    case 'assistant-said':
    case 'tool-result':
    case 'tool-denied':
    case 'nudge':
    case 'background-shell-awaiting-input':
    case 'background-shell-matched':
    case 'background-shell-still-running':
    case 'service-ended':
    case 'pr-event':
      return true
    case 'agent-reported':
      return reportWakesParent(event.kind)
    case 'agent-ended':
      return event.relayed !== false
    case 'background-shell-ended':
      return true
    default:
      return false
  }
}

/**
 * The type-only half of `isTurnTaking`, for the wire path: a body that failed the local schema
 * has no draft to inspect, but hydration still must not advance past a row whose type takes a
 * turn — a rejected `pr-event` is a durable intent that would otherwise be skipped forever.
 */
export const isTurnTakingType = (type: string): boolean =>
  type === 'user-said' ||
  type === 'assistant-said' ||
  type === 'tool-result' ||
  type === 'tool-denied' ||
  type === 'nudge' ||
  type === 'background-shell-awaiting-input' ||
  type === 'background-shell-matched' ||
  type === 'background-shell-still-running' ||
  type === 'background-shell-ended' ||
  type === 'service-ended' ||
  type === 'agent-ended' ||
  type === 'pr-event'
