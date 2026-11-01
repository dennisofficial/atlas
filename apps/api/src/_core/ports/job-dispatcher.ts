import type { AnyTask, Task, TaskIdentifier, TaskPayload } from '@trigger.dev/sdk'
import type { ZodType } from 'zod'

export type { AnyTask, Task }

export interface TaskContract<TTask extends AnyTask> {
  id: TaskIdentifier<TTask>
  schema: ZodType<TaskPayload<TTask>>
}

export interface JobDispatch<TTask extends AnyTask> {
  task: TaskContract<TTask>
  payload: TaskPayload<TTask>
  idempotencyKey: string
  tags?: string[]
}

export class JobDispatchError extends Error {
  readonly taskId: string

  constructor({ taskId, cause }: { taskId: string; cause: unknown }) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    super(`dispatching ${taskId} failed: ${reason}`, { cause })
    this.name = 'JobDispatchError'
    this.taskId = taskId
  }
}

export abstract class JobDispatcher {
  abstract dispatch<TTask extends AnyTask>(args: JobDispatch<TTask>): Promise<{ runId: string }>
}
