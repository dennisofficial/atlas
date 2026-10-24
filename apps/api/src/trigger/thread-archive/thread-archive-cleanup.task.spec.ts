import { describe, expect, it, mock } from 'bun:test'

mock.module('@trigger.dev/sdk', () => ({
  schemaTask: <T>(definition: T): T => definition,
  schedules: { task: <T>(definition: T): T => definition },
  TriggerClient: class {
    readonly tasks = { trigger: async () => ({ id: 'run_stub' }) }
  },
}))

const { threadArchiveCleanupTask } = await import('./thread-archive-cleanup.task')

describe('threadArchiveCleanupTask', () => {
  it('registers thread-archive-cleanup with three attempts and a two minute cap', () => {
    expect(threadArchiveCleanupTask).toMatchObject({
      id: 'thread-archive-cleanup',
      retry: { maxAttempts: 3 },
      maxDuration: 120,
    })
  })
})
