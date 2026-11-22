import { schemaTask } from '@trigger.dev/sdk'
import type {
  PodDiskGrowOneOutput,
  PodDiskGrowOnePayload,
} from '@dltech/atlas-jobs/pod-disk-grow-one'
import {
  POD_DISK_GROW_ONE_TASK_ID,
  podDiskGrowOnePayloadSchema,
} from '@dltech/atlas-jobs/pod-disk-grow-one'
import '../init'
import { buildPodDiskGrowOneGraph } from './pod-disk-grow-one-graph'

export async function runPodDiskGrowOneTask(
  payload: PodDiskGrowOnePayload,
): Promise<PodDiskGrowOneOutput> {
  return await buildPodDiskGrowOneGraph().run(payload)
}

export const podDiskGrowOneTask = schemaTask({
  id: POD_DISK_GROW_ONE_TASK_ID,
  schema: podDiskGrowOnePayloadSchema,
  retry: { maxAttempts: 2 },
  maxDuration: 120,
  run: runPodDiskGrowOneTask,
})
