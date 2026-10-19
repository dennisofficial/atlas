import { schedules } from '@trigger.dev/sdk'
import { withGithubSweepGraph } from './github-sweep-graph'

export const githubHookSweepTask = schedules.task({
  id: 'github-hook-sweep',
  cron: '*/1 * * * *',
  retry: { maxAttempts: 3 },
  run: async () => withGithubSweepGraph({ run: (graph) => graph.hookLifecycle.handleSweep() }),
})
