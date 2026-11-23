import { schedules } from '@trigger.dev/sdk'
import { withGithubSweepGraph } from './github-sweep-graph'

export const githubV1WakeSweepTask = schedules.task({
  id: 'github-v1-wake-sweep',
  cron: '*/1 * * * *',
  retry: { maxAttempts: 3 },
  run: async () =>
    withGithubSweepGraph({
      run: async (graph) => {
        await graph.pollSweeper.refreshLiveUntil()
        await graph.wake.retryFailedWakes()
        await graph.outbox.drainLegacy()
      },
    }),
})
