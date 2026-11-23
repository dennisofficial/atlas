import { schedules } from '@trigger.dev/sdk'
import type { PodDiskGrowSummary } from '@dltech/atlas-pods'
import '../init'
import { buildPodDiskGrowGraph } from './pod-disk-grow-graph'

export const POD_DISK_GROW_TASK_ID = 'pod-disk-grow'

export async function runPodDiskGrowTask(): Promise<PodDiskGrowSummary> {
  return await buildPodDiskGrowGraph().run()
}

export const podDiskGrowTask = schedules.task({
  id: POD_DISK_GROW_TASK_ID,
  cron: { pattern: '* * * * *', window: '0m' },
  retry: { maxAttempts: 1 },
  run: async () => await runPodDiskGrowTask(),
})
