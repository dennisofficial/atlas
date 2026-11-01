import { describe, expect, it, mock } from 'bun:test'

mock.module('@trigger.dev/sdk', () => ({
  schemaTask: <T>(definition: T): T => definition,
  schedules: { task: <T>(definition: T): T => definition },
  TriggerClient: class {
    readonly tasks = { trigger: async () => ({ id: 'run_stub' }) }
  },
}))

const { githubHookSweepTask } = await import('./github-hook-sweep.task')
const { githubPollSweepTask } = await import('./github-poll-sweep.task')
const { githubWebhookReconcileTask } = await import('./github-webhook-reconcile.task')

describe('github sweep tasks', () => {
  it('registers the poll sweep every minute with three attempts', () => {
    expect(githubPollSweepTask).toMatchObject({
      id: 'github-poll-sweep',
      cron: '*/1 * * * *',
      retry: { maxAttempts: 3 },
    })
  })

  it('registers the hook sweep every minute with three attempts', () => {
    expect(githubHookSweepTask).toMatchObject({
      id: 'github-hook-sweep',
      cron: '*/1 * * * *',
      retry: { maxAttempts: 3 },
    })
  })

  it('registers the webhook inbox reconcile every five minutes with three attempts', () => {
    expect(githubWebhookReconcileTask).toMatchObject({
      id: 'github-webhook-reconcile',
      cron: '*/5 * * * *',
      retry: { maxAttempts: 3 },
    })
  })
})
