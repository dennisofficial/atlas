import { describe, expect, it, mock } from 'bun:test'

mock.module('@trigger.dev/sdk', () => ({
  schemaTask: <T>(definition: T): T => definition,
  schedules: { task: <T>(definition: T): T => definition },
  TriggerClient: class {
    readonly tasks = { trigger: async () => ({ id: 'run_stub' }) }
  },
  logger: { log: () => undefined, warn: () => undefined, error: () => undefined },
}))

const { githubV1WakeSweepTask } = await import('./github-v1-wake-sweep.task')

describe('github v1 wake sweep task', () => {
  it('registers the v1 effects drain every minute with three attempts', () => {
    expect(githubV1WakeSweepTask).toMatchObject({
      id: 'github-v1-wake-sweep',
      cron: '*/1 * * * *',
      retry: { maxAttempts: 3 },
    })
  })
})
