import { schedules } from '@trigger.dev/sdk'
import '../init'
import { withGithubSweeps } from './github-sweep-graph'
import { runGithubPollSweep } from './github-sweeps'

export const githubPollSweepTask = schedules.task({
  id: 'github-poll-sweep',
  cron: { pattern: '*/1 * * * *', window: '0m' },
  retry: { maxAttempts: 3 },
  run: async () => withGithubSweeps({ run: runGithubPollSweep }),
})
