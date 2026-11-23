import {
  pruneCommitChecks,
  type GithubDeliveryService,
  type GithubHookSweepService,
  type GithubPollSweeperService,
  type GithubPrOutboxDispatcher,
  type GithubWebhookInboxService,
} from '@dltech/atlas-github'

export type GithubHookSweepDeps = { hookSweep: Pick<GithubHookSweepService, 'handleSweep'> }

export type GithubPollSweepDeps = { pollSweeper: Pick<GithubPollSweeperService, 'handlePoll'> }

export type GithubWebhookReconcileDeps = {
  webhookInbox: Pick<GithubWebhookInboxService, 'reviveStarved' | 'handleReconcile' | 'prune'>
  deliveries: Pick<GithubDeliveryService, 'handle'>
  outbox: Pick<GithubPrOutboxDispatcher, 'drain' | 'prune'>
}

export const runGithubHookSweep = (args: GithubHookSweepDeps): Promise<void> =>
  args.hookSweep.handleSweep()

export const runGithubPollSweep = (args: GithubPollSweepDeps): Promise<void> =>
  args.pollSweeper.handlePoll()

export async function runGithubWebhookReconcile(args: {
  graph: GithubWebhookReconcileDeps
  now: Date
}): Promise<void> {
  const { webhookInbox, deliveries, outbox } = args.graph
  const { now } = args
  await webhookInbox.reviveStarved({ now })
  await webhookInbox.handleReconcile({
    process: (entry) => deliveries.handle({ ...entry, replay: true }),
  })
  await webhookInbox.prune({ now })
  await outbox.drain()
  await outbox.prune({ now })
  await pruneCommitChecks({ now })
}
