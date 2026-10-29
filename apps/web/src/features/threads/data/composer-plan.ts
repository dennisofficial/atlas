import { EPlanStatus, planFromEvents, planTaskLabel, type Event } from '@dltech/atlas-core'
import { EStepStatus, type PlanStep } from '@dltech/atlas-ui/ai/plan'

const STEP_STATUS: Record<EPlanStatus, EStepStatus> = {
  [EPlanStatus.Pending]: EStepStatus.Pending,
  [EPlanStatus.InProgress]: EStepStatus.Running,
  [EPlanStatus.Completed]: EStepStatus.Done,
}

export function planStepsOf(events: readonly Event[]): PlanStep[] {
  return planFromEvents(events).map((task) => ({
    id: String(task.ordinal),
    title: planTaskLabel(task),
    status: STEP_STATUS[task.status],
  }))
}
