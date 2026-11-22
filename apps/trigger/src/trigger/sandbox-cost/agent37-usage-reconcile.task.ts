import { schedules } from '@trigger.dev/sdk'
import {
  liveAgent37Client,
  readPodsEnv,
  reconcileAgent37Usage,
  recordSandboxRunMeter,
  type Agent37UsageReconcileSummary,
} from '@dltech/atlas-pods'
import '../init'
import { triggerLog } from '../trigger-logger'

export async function runAgent37UsageReconcile(args: {
  now?: Date | undefined
}): Promise<Agent37UsageReconcileSummary> {
  const agent37 = readPodsEnv().agent37
  if (agent37 === null) return { instances: 0, meteredRuns: 0 }
  return await reconcileAgent37Usage({
    usage: liveAgent37Client({ apiKey: agent37.apiKey }),
    meter: recordSandboxRunMeter,
    now: args.now ?? new Date(),
    log: (line) => triggerLog.log(line),
  })
}

export const agent37UsageReconcileTask = schedules.task({
  id: 'agent37-usage-reconcile',
  cron: '5 * * * *',
  retry: { maxAttempts: 3 },
  run: async () => await runAgent37UsageReconcile({}),
})
