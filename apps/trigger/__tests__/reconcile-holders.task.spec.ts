import { describe, expect, it, mock } from 'bun:test'

import { RECONCILE_HOLDERS_CRON, RECONCILE_HOLDERS_TASK_ID } from '@dltech/atlas-jobs'

// The SDK is mocked identity-style: importing @trigger.dev/sdk for real pulls in the
// authenticated runtime config, which a spec does not have. This still proves the task module
// registers under the jobs contract id and cron.
mock.module('@trigger.dev/sdk', () => ({
  schedules: { task: <T>(definition: T): T => definition },
}))

const { reconcileHoldersTask } = await import('../src/tasks/reconcile-holders.task')

describe('reconcile-holders task', () => {
  it('registers under the jobs contract id and cron', () => {
    expect(reconcileHoldersTask).toMatchObject({
      id: RECONCILE_HOLDERS_TASK_ID,
      cron: RECONCILE_HOLDERS_CRON,
    })
  })
})
