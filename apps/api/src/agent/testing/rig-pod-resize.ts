import { appendFileSync } from 'node:fs'

import type { ViewChangeHook } from '@dltech/atlas-control'
import type { LogPort } from '@dltech/atlas-observability'

import {
  JobsProjectDispatcher,
  type AnyTask,
  type JobDispatch,
} from '../../_core/ports/job-dispatcher'
import { podResizeOnIdleOf } from '../host/pod-resize-on-idle.port'

class RecordingResizeDispatcher extends JobsProjectDispatcher {
  constructor(private readonly path: string) {
    super()
  }

  async dispatch<TTask extends AnyTask>(args: JobDispatch<TTask>): Promise<{ runId: string }> {
    appendFileSync(
      this.path,
      `${JSON.stringify({
        taskId: args.task.id,
        idempotencyKey: args.idempotencyKey,
        payload: args.payload,
      })}\n`,
    )
    return { runId: 'rig-pod-resize' }
  }
}

export const podResizeViewHooksOf = (args: {
  path: string | undefined
  log: LogPort
}): { viewHooks?: readonly ViewChangeHook[] } => {
  if (args.path === undefined || args.path === '') return {}
  const dispatcher = new RecordingResizeDispatcher(args.path)
  return { viewHooks: [podResizeOnIdleOf({ dispatcher, log: args.log })] }
}
