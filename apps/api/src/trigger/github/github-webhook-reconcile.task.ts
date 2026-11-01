import { schedules } from '@trigger.dev/sdk'
import { withGithubSweepGraph } from './github-sweep-graph'

export const githubWebhookReconcileTask = schedules.task({
  id: 'github-webhook-reconcile',
  cron: '*/5 * * * *',
  retry: { maxAttempts: 3 },
  run: async () =>
    withGithubSweepGraph({
      run: (graph) =>
        graph.webhookInbox.handleReconcile({
          process: (entry) => graph.deliveries.handle(entry),
        }),
    }),
})
