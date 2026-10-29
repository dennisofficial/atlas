import {
  EPlanStatus,
  foldPlan,
  PLAN_DONE_TAIL,
  PLAN_FOLD_MIN,
  planTaskLabel,
} from '@dltech/atlas-core'

import { ESidebarTaskState, type SidebarTask } from '../store/sidebar-model'
import { wrapCells } from './components/sidebar/cells'

export const TODO_MARK_CELLS = 2

export enum ETodoRow {
  Head = 'head',
  Continuation = 'continuation',
}

export type TodoRow = {
  key: string
  kind: ETodoRow
  text: string
  state: ESidebarTaskState
}

export function todoLabel(task: SidebarTask): string {
  return planTaskLabel({
    text: task.label,
    status: PLAN_STATUS_OF[task.state],
    activeForm: task.activeForm,
  })
}

function taskRows(args: { task: SidebarTask; cells: number }): TodoRow[] {
  return wrapCells({ text: todoLabel(args.task), cells: args.cells }).map((text, index) => ({
    key: `${args.task.id}:${index}`,
    kind: index === 0 ? ETodoRow.Head : ETodoRow.Continuation,
    text,
    state: args.task.state,
  }))
}

export function todoRows(args: { tasks: readonly SidebarTask[]; cells: number }): TodoRow[] {
  const room = Math.max(0, args.cells - TODO_MARK_CELLS)

  return args.tasks.flatMap((task) => taskRows({ task, cells: room }))
}

export type TodoFold = {
  shown: readonly SidebarTask[]
  hidden: number
}

const PLAN_STATUS_OF: Record<ESidebarTaskState, EPlanStatus> = {
  [ESidebarTaskState.Pending]: EPlanStatus.Pending,
  [ESidebarTaskState.Running]: EPlanStatus.InProgress,
  [ESidebarTaskState.Done]: EPlanStatus.Completed,
}

export function foldTodo(args: { tasks: readonly SidebarTask[]; expanded: boolean }): TodoFold {
  const folded = foldPlan({
    tasks: args.tasks.map((task) => ({ task, status: PLAN_STATUS_OF[task.state] })),
    expanded: args.expanded,
  })

  return { shown: folded.shown.map((entry) => entry.task), hidden: folded.hidden }
}
