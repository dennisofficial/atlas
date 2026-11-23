import { schedules } from '@trigger.dev/sdk'
import '../init'
import { withGithubSweeps } from './github-sweep-graph'
import { runGithubHookSweep } from './github-sweeps'

export const githubHookSweepTask = schedules.task({
  id: 'github-hook-sweep',
  cron: { pattern: '*/1 * * * *', window: '0m' },
  retry: { maxAttempts: 3 },
  run: async () => withGithubSweeps({ run: runGithubHookSweep }),
})
