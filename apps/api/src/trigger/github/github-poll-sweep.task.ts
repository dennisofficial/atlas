import { schedules } from '@trigger.dev/sdk'
import { withGithubSweepGraph } from './github-sweep-graph'

export const githubPollSweepTask = schedules.task({
  id: 'github-poll-sweep',
  cron: '*/1 * * * *',
  retry: { maxAttempts: 3 },
  run: async () => withGithubSweepGraph({ run: (graph) => graph.pollSweeper.handlePoll() }),
})
