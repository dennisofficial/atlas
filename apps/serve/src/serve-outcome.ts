import { ETurnStatus, type TurnOutcome, type TurnOutcomeWire } from '@dltech/atlas-harness'

export const wireOutcomeOf = (outcome: TurnOutcome): TurnOutcomeWire => {
  if (outcome.status !== ETurnStatus.Failed) return outcome
  return { status: outcome.status, runId: outcome.runId, message: outcome.message }
}

export const DORMANT_REFUSAL = 'this session is waiting to be activated by the handoff that prepared it'
