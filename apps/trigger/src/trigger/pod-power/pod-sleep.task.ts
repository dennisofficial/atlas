import { schemaTask } from '@trigger.dev/sdk'
import type { PodSleepOutput, PodSleepPayload } from '@dltech/atlas-jobs/pod-sleep'
import { POD_SLEEP_TASK_ID, podSleepPayloadSchema } from '@dltech/atlas-jobs/pod-sleep'
import { runPodSleep } from '@dltech/atlas-pods'
import '../init'
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
})
