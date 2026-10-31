import { ETurnStatus, type TurnOutcome } from '../loop/turn-outcome'
import type { ActivityOutcome, ActivityReport, ActivityTracker } from './types'

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

export const NOOP_ACTIVITY_TRACKER: ActivityTracker = {
  turnStarted: () => undefined,
  turnOutcome: () => undefined,
  turnFailed: () => undefined,
  turnEnded: () => undefined,
  setInput: () => undefined,
  setApproval: () => undefined,
  setBackground: () => undefined,
}

export function createActivityTracker(args: {
  report: (state: ActivityReport) => void
}): ActivityTracker {
  let turning = false
  let background = false
  let input = false
  let approval = false
  let outcome: ActivityOutcome | undefined

  const emit = (): void => {
    const working = turning || background
    const awaiting = input ? 'input' : approval ? 'approval' : null
    args.report({
      working,
      awaiting,
      ...(working || outcome === undefined ? {} : { lastOutcome: outcome }),
    })
  }

  return {
    turnStarted: () => {
      turning = true
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
      turning = false
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
    setBackground: (running) => {
      if (background === running) return
      background = running
      emit()
    },
  }
}
