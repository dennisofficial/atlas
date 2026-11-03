import { describe, expect, it, mock } from 'bun:test'

import { V2_RECONCILE_HOLDERS_CRON, V2_RECONCILE_HOLDERS_TASK_ID } from '@dltech/atlas-jobs'

// The SDK is mocked identity-style: importing @trigger.dev/sdk for real pulls in the
// authenticated runtime config, which a spec does not have. This still proves the task module
// registers under the jobs contract id and cron.
mock.module('@trigger.dev/sdk', () => ({
  schedules: { task: <T>(definition: T): T => definition },
}))

const { v2ReconcileHoldersTask } = await import('../src/tasks/v2-reconcile-holders.task')

describe('v2-reconcile-holders task', () => {
  it('registers under the jobs contract id and cron', () => {
    expect(v2ReconcileHoldersTask).toMatchObject({
      id: V2_RECONCILE_HOLDERS_TASK_ID,
      cron: V2_RECONCILE_HOLDERS_CRON,
    })
  })
})
