import {
  type AppRoutine,
  clockAt,
  ERoutineState,
  NOW,
  relativeOf,
  stateOf,
} from './routines.fixtures'

export const metaLineOf = (routine: AppRoutine): string => {
  const state = stateOf(routine)
  if (state === ERoutineState.Working && routine.currentRun !== undefined) {
    return `Running since ${clockAt(routine.currentRun.startedAt)}`
  }
  if (state === ERoutineState.Off) return `${routine.short} · paused`
  if (state === ERoutineState.Skipped) return `${routine.short} · last run skipped`
  return `${routine.short} · next ${relativeOf({ from: NOW, to: routine.nextRunAt })}`
}
