import { schemaTask } from '@trigger.dev/sdk'
import {
  POD_RESIZE_TASK_ID,
  podResizePayloadSchema,
  type PodResizeOutput,
  type PodResizePayload,
  type PodResizeTask,
} from '../../api/platform/control/pod-resize.contract'
import { failureText, runPodResize } from '../../api/platform/control/pod-resize-run'
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
}) satisfies PodResizeTask
