import { describe, expect, it, vi } from 'vitest'

vi.mock('@trigger.dev/sdk', () => ({
  schedules: { task: <T>(definition: T): T => definition },
}))

import { githubHookSweepTask } from './github-hook-sweep.task'
import { githubPollSweepTask } from './github-poll-sweep.task'

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
