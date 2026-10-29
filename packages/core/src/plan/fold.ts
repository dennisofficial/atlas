import { EPlanStatus, type PlanTask } from './plan'

export const PLAN_DONE_TAIL = 2

export const PLAN_FOLD_MIN = 2

export type PlanFold<TTask extends { status: EPlanStatus }> = {
  shown: readonly TTask[]
  hidden: number
}

export function planTaskLabel(task: Pick<PlanTask, 'text' | 'status' | 'activeForm'>): string {
  if (task.status !== EPlanStatus.InProgress) return task.text

  return task.activeForm ?? task.text
}

export function foldPlan<TTask extends { status: EPlanStatus }>(args: {
  tasks: readonly TTask[]
  expanded: boolean
}): PlanFold<TTask> {
  const completed = args.tasks.filter((task) => task.status === EPlanStatus.Completed)
  const folded = completed.length - PLAN_DONE_TAIL
  if (folded < PLAN_FOLD_MIN) return { shown: args.tasks, hidden: 0 }

  const active = args.tasks.filter((task) => task.status !== EPlanStatus.Completed)
  const hidden = completed.slice(0, folded)
  const tail = completed.slice(folded)

  return {
    shown: [...(args.expanded ? hidden : []), ...tail, ...active],
    hidden: hidden.length,
  }
}
