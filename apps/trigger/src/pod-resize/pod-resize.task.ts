import { schemaTask } from '@trigger.dev/sdk'
import type { PodResizeOutput, PodResizePayload } from '@dltech/atlas-jobs/pod-resize'
import { POD_RESIZE_TASK_ID, podResizePayloadSchema } from '@dltech/atlas-jobs/pod-resize'
import { failureText, runPodResize } from '@dltech/atlas-pods'
import '../init'
import { buildPodResizeGraph } from './pod-resize-graph'

export async function runPodResizeTask(payload: PodResizePayload): Promise<PodResizeOutput> {
  const { deps } = buildPodResizeGraph()
  return runPodResize({ payload, deps })
}

export const podResizeTask = schemaTask({
  id: POD_RESIZE_TASK_ID,
  schema: podResizePayloadSchema,
  retry: { maxAttempts: 3 },
  maxDuration: 120,
  run: runPodResizeTask,
  onFailure: async ({ payload, error }) => {
    const { deps } = buildPodResizeGraph()
    await deps.recordFailed({
      sessionId: payload.sessionId,
      generation: payload.generation,
      error: failureText(error),
    })
  },
})
