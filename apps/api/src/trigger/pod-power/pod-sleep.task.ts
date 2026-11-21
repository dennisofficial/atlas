import { schemaTask } from '@trigger.dev/sdk'

import {
  POD_SLEEP_TASK_ID,
  podSleepPayloadSchema,
  type PodSleepOutput,
  type PodSleepPayload,
  type PodSleepTask,
} from '../../api/platform/control/pod-sleep.contract'
import { runPodSleep } from '../../api/platform/control/pod-sleep-run'
import { buildPodSleepGraph } from './pod-sleep-graph'

export async function runPodSleepTask(payload: PodSleepPayload): Promise<PodSleepOutput> {
  const { deps } = buildPodSleepGraph()
  return runPodSleep({ payload, deps })
}

export const podSleepTask = schemaTask({
  id: POD_SLEEP_TASK_ID,
  schema: podSleepPayloadSchema,
  retry: { maxAttempts: 3 },
  maxDuration: 120,
  run: runPodSleepTask,
}) satisfies PodSleepTask
