import type { EventDraft } from '../events/body'

export const TEAMMATE_AGENT_TYPE = 'teammate'

export const isTeammateType = (agentType: string): boolean => agentType === TEAMMATE_AGENT_TYPE

/** Whether the event hands the turn to the assistant — the one projection run-turn and resume read. */
export const isTurnTaking = (event: EventDraft): boolean => {
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
    case 'agent-reported':
    case 'agent-ended':
      return true
    case 'background-shell-ended':
      // A recorded ending is bookkeeping that settles the log; the ending was already spoken
      // (a shell_kill tool result), so it must not hand the turn back to the assistant on resume.
      return event.recorded !== true
    default:
      return false
  }
}
