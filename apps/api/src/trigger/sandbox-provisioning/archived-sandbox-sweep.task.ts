import { schedules } from '@trigger.dev/sdk'
import {
  sweepArchivedSandboxes,
  type ArchivedSandboxSweepSummary,
} from '../../api/cloud/sandbox-provisioning/archived-sandbox-sweep'
import { workerArchivedSandboxSweepGraph } from './archived-sandbox-sweep-graph'

export async function runArchivedSandboxSweep(): Promise<ArchivedSandboxSweepSummary> {
  const { deps, dispose } = workerArchivedSandboxSweepGraph()
  try {
    return await sweepArchivedSandboxes({ now: new Date(), deps })
  } finally {
    await dispose()
  }
}

export const archivedSandboxSweepTask = schedules.task({
  id: 'archived-sandbox-sweep',
  cron: '23 6 * * *',
  retry: { maxAttempts: 1 },
  run: runArchivedSandboxSweep,
})
