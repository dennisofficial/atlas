import type { ThreadSignalsService } from '../../platform/sessions/thread-signals.service'
import type { GithubPrFanoutService } from './github-pr-fanout.service'
import { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
import { GithubPrOutboxDispatcher } from './github-pr-outbox'
import { GithubPrMergeabilityRefresh } from './github-pr-mergeability-refresh'
import { GithubPrReconcile } from './github-pr-reconcile'
import { GithubPrStore } from './github-pr-store'
import type { GithubHttpBudget } from './github-request-budget'
import type { GithubSandboxWakeService } from './github-sandbox-wake.service'
import type { GithubUserReads } from './github-user-reads'

export type PrApplyWiring = {
  mailbox: GithubPrEventMailboxService
  dispatcher: GithubPrOutboxDispatcher
  store: GithubPrStore
}

export function buildPrApplyWiring(args: {
  fanout: GithubPrFanoutService
  signals: Pick<ThreadSignalsService, 'threadChanged'>
  wake: Pick<GithubSandboxWakeService, 'notifyEvent'>
  reads: Pick<GithubUserReads, 'readHeadChecksOf' | 'readPullRequestObservation'>
  budget: GithubHttpBudget
  fillTokenOf: (args: {
    repoFullName: string
    installationId: bigint | undefined
  }) => Promise<string | undefined>
}): PrApplyWiring {
  let bound: GithubPrStore | null = null
  const storeOf = () => {
    if (bound === null) throw new Error('the pr outbox ran before the wiring built its store')
    return bound
  }
  const reconcile = new GithubPrReconcile({
    store: storeOf,
    fillTokenOf: args.fillTokenOf,
    reads: args.reads,
    budget: args.budget,
  })
  const mergeability = new GithubPrMergeabilityRefresh({
    store: storeOf,
    fillTokenOf: args.fillTokenOf,
    reads: args.reads,
    budget: args.budget,
  })
  const dispatcher = new GithubPrOutboxDispatcher({
    fanout: args.fanout,
    signals: args.signals,
    wake: args.wake,
    reconcile: (run) => reconcile.run(run),
    mergeability: (run) => mergeability.run(run),
  })
  const mailbox = new GithubPrEventMailboxService(args.fanout, dispatcher)
  bound = new GithubPrStore({ mailbox, dispatcher })

  return { mailbox, dispatcher, store: bound }
}
