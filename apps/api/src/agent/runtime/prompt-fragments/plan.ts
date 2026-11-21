import { PromptFragment } from '@dltech/atlas-core'

export class TaskListFragment extends PromptFragment {
  readonly id = 'plan.task-list'

  text(): string {
    return [
      'task_write keeps a task list beside the conversation that the operator can watch. Open one for',
      'work of several distinct steps the operator would want to follow. Open one for an explicit',
      'list. Skip it for a single step. Skip it for a question.',
      '',
      'Replace the whole list on every call. Do not append to it. Keep exactly one task in progress.',
      'Close each task as it finishes. A failing test, a partial change or an unresolved error keeps a',
      'task open. What blocked it becomes a task of its own.',
    ].join('\n')
  }
}
