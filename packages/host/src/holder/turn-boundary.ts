import { ETurnEndedBy, ETurnOutcome } from '@dltech/atlas-core'
import { ETurnStatus, OPERATOR_STOP_REASON, type TurnOutcome } from '@dltech/atlas-agent'

export enum ETurnAborted {
  Stop = 'stop',
  Handoff = 'handoff',
  LeaseLost = 'lease-lost',
  Other = 'other',
}

export type TurnEnding = { outcome: ETurnOutcome; by: ETurnEndedBy }

export const turnAbortedOf = (reason: unknown): ETurnAborted => {
  if (reason === OPERATOR_STOP_REASON) return ETurnAborted.Stop
  if (reason === ETurnAborted.Handoff) return ETurnAborted.Handoff
  if (reason === undefined) return ETurnAborted.LeaseLost
  return ETurnAborted.Other
}

const AFTER_INTERRUPTED: Readonly<Record<ETurnAborted, TurnEnding | null>> = {
  [ETurnAborted.Stop]: { outcome: ETurnOutcome.Stopped, by: ETurnEndedBy.Operator },
  [ETurnAborted.Handoff]: null,
  [ETurnAborted.LeaseLost]: null,
  [ETurnAborted.Other]: { outcome: ETurnOutcome.Interrupted, by: ETurnEndedBy.Host },
}

export const turnEndingOf = (args: {
  outcome: TurnOutcome
  aborted: ETurnAborted
}): TurnEnding | null => {
  switch (args.outcome.status) {
    case ETurnStatus.Completed:
    case ETurnStatus.Idle:
      return { outcome: ETurnOutcome.Completed, by: ETurnEndedBy.Agent }
    case ETurnStatus.Failed:
      return { outcome: ETurnOutcome.Failed, by: ETurnEndedBy.Agent }
    case ETurnStatus.Interrupted:
      return AFTER_INTERRUPTED[args.aborted]
    case ETurnStatus.HandoffPaused:
      return null
    case ETurnStatus.Paused:
      return null
    case ETurnStatus.Parked:
      return null
    case ETurnStatus.WaitingForModel:
      return null
  }
}

export const FAILED_BY_HOST: TurnEnding = {
  outcome: ETurnOutcome.Failed,
  by: ETurnEndedBy.Host,
}

export const ORPHAN_INTERRUPTED: TurnEnding = {
  outcome: ETurnOutcome.Interrupted,
  by: ETurnEndedBy.Host,
}

export const STOPPED_BY_OPERATOR: TurnEnding = {
  outcome: ETurnOutcome.Stopped,
  by: ETurnEndedBy.Operator,
}
