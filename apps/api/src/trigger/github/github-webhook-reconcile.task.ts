import { schedules } from '@trigger.dev/sdk'
import { pruneCommitChecks } from '../../api/cloud/github/github-commit-checks'
import { withGithubSweepGraph } from './github-sweep-graph'

export const githubWebhookReconcileTask = schedules.task({
  id: 'github-webhook-reconcile',
  cron: '*/1 * * * *',
  retry: { maxAttempts: 3 },
  run: async () =>
    withGithubSweepGraph({
      run: async (graph) => {
        await graph.webhookInbox.handleReconcile({
          process: (entry) => graph.deliveries.handle({ ...entry, replay: true }),
        })
        await pruneCommitChecks({ now: new Date() })
      },
    }),
})
