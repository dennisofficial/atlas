import { schedules } from '@trigger.dev/sdk'
import {
  recoverStuckSessions,
  type StuckRecoverySummary,
} from '../../api/cloud/sandbox-provisioning/stuck-session-recovery'
import { workerStuckSessionSweepGraph } from './stuck-session-sweep-graph'

export async function runStuckSessionSweep(): Promise<StuckRecoverySummary> {
  const { deps, dispose } = workerStuckSessionSweepGraph()
  try {
    return await recoverStuckSessions({ deps })
  } finally {
    await dispose()
  }
}

export const stuckSessionSweepTask = schedules.task({
  id: 'stuck-session-sweep',
  cron: '*/5 * * * *',
  retry: { maxAttempts: 1 },
  run: runStuckSessionSweep,
})
