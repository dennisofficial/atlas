import { schedules } from '@trigger.dev/sdk'
import '../init'
import { withGithubSweeps } from './github-sweep-graph'
import { runGithubWebhookReconcile } from './github-sweeps'

export const githubWebhookReconcileTask = schedules.task({
  id: 'github-webhook-reconcile',
  cron: { pattern: '*/1 * * * *', window: '0m' },
  retry: { maxAttempts: 3 },
  run: async () =>
    withGithubSweeps({ run: (graph) => runGithubWebhookReconcile({ graph, now: new Date() }) }),
})
