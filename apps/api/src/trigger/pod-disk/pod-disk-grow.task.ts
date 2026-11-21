import { schedules } from '@trigger.dev/sdk'

import type { PodDiskGrowSummary } from '../../api/platform/control/pod-disk-grow-run'
import { buildPodDiskGrowGraph } from './pod-disk-grow-graph'

export const POD_DISK_GROW_TASK_ID = 'pod-disk-grow'

export async function runPodDiskGrowTask(): Promise<PodDiskGrowSummary> {
  return await buildPodDiskGrowGraph().run()
}

export const podDiskGrowTask = schedules.task({
  id: POD_DISK_GROW_TASK_ID,
  cron: '*/5 * * * *',
  retry: { maxAttempts: 1 },
  run: async () => await runPodDiskGrowTask(),
})
