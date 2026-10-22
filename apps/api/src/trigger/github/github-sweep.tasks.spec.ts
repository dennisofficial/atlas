import { describe, expect, it, mock } from 'bun:test'

mock.module('@trigger.dev/sdk', () => ({
  schedules: { task: <T>(definition: T): T => definition },
}))

const { githubHookSweepTask } = await import('./github-hook-sweep.task')
const { githubPollSweepTask } = await import('./github-poll-sweep.task')

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
})
