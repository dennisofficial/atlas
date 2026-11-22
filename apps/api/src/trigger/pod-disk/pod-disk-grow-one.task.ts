import { schemaTask } from '@trigger.dev/sdk'

import {
  POD_DISK_GROW_ONE_TASK_ID,
  podDiskGrowOnePayloadSchema,
  type PodDiskGrowOneOutput,
  type PodDiskGrowOnePayload,
  type PodDiskGrowOneTask,
} from '../../agent/host/pod-disk-grow-one.contract'
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
}) satisfies PodDiskGrowOneTask
