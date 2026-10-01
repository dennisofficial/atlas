import type { EventDraft } from '../events/body'

export const TEAMMATE_AGENT_TYPE = 'teammate'

/**
 * How an agent's speech reaches the thread that spawned it. The agent type declares one; every
 * consumer — notices, assembly, turn-taking, the transcript — derives its behavior from it rather
 * than branching on the type's name.
 */
export enum ESpeechModel {
  /** The ending is the report: the parent hears the agent when it stops and never before. */
  ReportOnEnd = 'report-on-end',
  /**
   * The agent speaks by calling report_to_main; its ending relays to the parent once nothing it
   * owns — a live shell, service or child agent — can wake it again. A peer session's turn ends
   * for reasons of its own while work of its own is still in flight, and that pause is recorded
   * for the roster and rewind without waking the parent; the harness applies the live-work guard
   * when the ending is queued.
   */
  DeliberateReport = 'deliberate-report',
}

export const speechModelOf = (agentType: string): ESpeechModel =>
  agentType === TEAMMATE_AGENT_TYPE ? ESpeechModel.DeliberateReport : ESpeechModel.ReportOnEnd

export const isTeammateType = (agentType: string): boolean =>
  speechModelOf(agentType) === ESpeechModel.DeliberateReport

/** An ending the parent must hear: it renders to the model, wakes the thread, and shows in the transcript. */
export const endingIsSpeech = (agentType: string): boolean =>
  speechModelOf(agentType) === ESpeechModel.ReportOnEnd

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
      return true
    case 'background-shell-ended':
      // A recorded ending is bookkeeping that settles the log; the ending was already spoken
      // (a shell_kill tool result), so it must not hand the turn back to the assistant on resume.
      return event.recorded !== true
    case 'agent-ended':
      return endingIsSpeech(event.agentType)
    default:
      return false
  }
}
