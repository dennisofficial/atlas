import type { AnyTask } from '@trigger.dev/sdk'
import { TriggerClient } from '@trigger.dev/sdk'
import { type JobDispatch, JobDispatchError, JobDispatcher } from '../../_core/ports/job-dispatcher'

export class TriggerJobDispatcher extends JobDispatcher {
  private readonly client: TriggerClient

  constructor({ secretKey }: { secretKey: string }) {
    super()
    this.client = new TriggerClient({ accessToken: secretKey })
  }

  async dispatch<TTask extends AnyTask>({
    task,
    payload,
    idempotencyKey,
    tags,
  }: JobDispatch<TTask>): Promise<{ runId: string }> {
    try {
      const validated = task.schema.parse(payload)
      const handle = await this.client.tasks.trigger<TTask>(task.id, validated, {
        idempotencyKey,
        ...(tags === undefined ? {} : { tags }),
      })
      return { runId: handle.id }
    } catch (cause) {
      throw new JobDispatchError({ taskId: task.id, cause })
    }
  }
}
