import {
  ETurnStatus,
  runFailureOf,
  type TurnOutcome,
  type TurnOutcomeWire,
} from '@dltech/atlas-harness'

export const wireOutcomeOf = (
  outcome: TurnOutcome,
  identity?: { providerId: string; modelId: string } | undefined,
): TurnOutcomeWire => {
  if (outcome.status !== ETurnStatus.Failed) return outcome
  return {
    status: outcome.status,
    runId: outcome.runId,
    message: outcome.message,
    failure: runFailureOf({
      message: outcome.message,
      cause: outcome.cause,
      providerId: identity?.providerId,
      modelId: identity?.modelId,
    }),
  }
}
