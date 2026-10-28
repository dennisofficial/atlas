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
