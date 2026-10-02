import { PromptFragment } from '@dltech/atlas-core'


export class TaskListFragment extends PromptFragment {
  readonly id = 'plan.task-list'

  text(): string {
    return [
      'task_write keeps a checklist beside the conversation that the developer can watch. Open one for',
      'work of three or more steps or an explicit list; skip it for a single step and for a question.',
      '',
      'Replace the whole list on every call rather than appending. Keep exactly one task in progress and',
      'close each task as it finishes. A failing test, partial change, or unresolved error keeps a task',
      'open, and what blocked it becomes a task of its own.',
    ].join('\n')
  }
}
