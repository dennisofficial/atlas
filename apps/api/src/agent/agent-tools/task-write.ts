import {
  EToolEffect,
  PLAN_TASK_LIMIT,
  PLAN_TOOL_NAME,
  planInputSchema,
  planTasks,
  renderPlan,
  SchemaTool,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'

const description = [
  'Write the task list where the operator can see it. It renders as a checklist beside the conversation.',
  '',
  'Send the WHOLE task list every time. This call replaces the list. Keep the tasks that still matter and remove the ones that no longer matter. Numbers follow position, so do not choose them yourself.',
  '',
  'Each task is one short imperative phrase, written for someone glancing at a narrow panel. Do not write a paragraph or a filename. The statuses are `pending`, `in_progress` and `completed`. Keep each status current: mark a task `in_progress` when you start it, and `completed` as soon as it is done, in the same call that adds what you learned.',
  '',
  'Give each task an `activeForm` too: the same task said as what you are doing rather than what you will do. `Fix the failing test` becomes `Fixing the failing test`. It shows beneath the task while that task is in progress, so send it on every task, not only the one you are starting.',
  '',
  `Ordinary work needs no task list. Use one when the operator would otherwise need to ask what you are doing. Include at most ${PLAN_TASK_LIMIT} tasks.`,
].join('\n')

export class TaskWriteTool extends SchemaTool<typeof planInputSchema> {
  readonly name = PLAN_TOOL_NAME
  readonly description = description
  readonly effect = EToolEffect.Read
  override readonly isConcurrencySafe = (): boolean => true
  readonly inputSchema = planInputSchema
  override readonly pathFields = TAKES_NO_PATHS

  protected override async run({ input }: ToolRun<typeof planInputSchema>): Promise<ToolOutcome> {
    const tasks = planTasks(input.tasks)

    return { ok: true, output: { tasks }, modelText: renderPlan(tasks) }
  }
}
