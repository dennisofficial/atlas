import { clockAt, relativeOf } from './routine-format'
import { scheduleSummaryOf } from './routine-schedule'
import { ERoutineState } from './routine-state'

export const metaLineOf = (args: {
  routine: { cron: string; lastRunAt: string | null; nextRunAt: string }
  state: ERoutineState
  now: number
  timeZone: string
}): string => {
  const { routine, state, now, timeZone } = args
  const schedule = scheduleSummaryOf(routine.cron)
  if (state === ERoutineState.Working && routine.lastRunAt !== null) {
    return `Running since ${clockAt({ iso: routine.lastRunAt, timeZone })}`
  }
  if (state === ERoutineState.Off) return `${schedule} · paused`
  if (state === ERoutineState.Skipped) return `${schedule} · last run skipped`
  return `${schedule} · next ${relativeOf({ from: now, to: routine.nextRunAt })}`
}
