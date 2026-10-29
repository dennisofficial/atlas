import { ETurnStatus, type TurnOutcome } from '@dltech/atlas-harness'

import type { ActivityState } from './serve-activity-reporter'

type ActivityOutcome = NonNullable<ActivityState['lastOutcome']>

export const activityOutcomeOf = (outcome: TurnOutcome): ActivityOutcome | undefined => {
  switch (outcome.status) {
    case ETurnStatus.Completed:
      return 'completed'
    case ETurnStatus.Failed:
      return 'failed'
    case ETurnStatus.Interrupted:
      return 'stopped'
    case ETurnStatus.Paused:
    case ETurnStatus.Idle:
    case ETurnStatus.RelocationPaused:
      return undefined
  }
}

export type ActivityTracker = {
  turnStarted: () => void
  turnOutcome: (outcome: TurnOutcome) => void
  turnFailed: () => void
  turnEnded: () => void
  setInput: (waiting: boolean) => void
  setApproval: (waiting: boolean) => void
}

export const NOOP_ACTIVITY_TRACKER: ActivityTracker = {
  turnStarted: () => undefined,
  turnOutcome: () => undefined,
  turnFailed: () => undefined,
  turnEnded: () => undefined,
  setInput: () => undefined,
  setApproval: () => undefined,
}

export function createActivityTracker(args: {
  report: (state: ActivityState) => void
}): ActivityTracker {
  let working = false
  let input = false
  let approval = false
  let outcome: ActivityOutcome | undefined

  const emit = (): void => {
    const awaiting = input ? 'input' : approval ? 'approval' : null
    args.report({
      working,
      awaiting,
      ...(working || outcome === undefined ? {} : { lastOutcome: outcome }),
    })
  }

  return {
    turnStarted: () => {
      working = true
      outcome = undefined
      emit()
    },
    turnOutcome: (given) => {
      outcome = activityOutcomeOf(given)
    },
    turnFailed: () => {
      outcome = 'failed'
    },
    turnEnded: () => {
      working = false
      emit()
    },
    setInput: (waiting) => {
      if (input === waiting) return
      input = waiting
      emit()
    },
    setApproval: (waiting) => {
      if (approval === waiting) return
      approval = waiting
      emit()
    },
  }
}
