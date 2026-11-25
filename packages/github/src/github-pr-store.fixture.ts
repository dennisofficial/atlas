import { RecordingDrain } from './testing/drain.fixture'
import { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import {
  GithubPrOutboxDispatcher,
  type PrMergeabilityRun,
  type PrReconcileRun,
} from './github-pr-outbox'
import { GithubPrStore } from './github-pr-store'

export function inertReconcile(): PrReconcileRun {
  return async () => undefined
}

export function inertMergeabilityRefresh(): PrMergeabilityRun {
  return async () => undefined
}

export function storeFixture(
  args: { fanout?: GithubPrFanoutService; mergeability?: PrMergeabilityRun } = {},
): GithubPrStore {
  const fanout = args.fanout ?? new GithubPrFanoutService(new RecordingDrain())
  const dispatcher = new GithubPrOutboxDispatcher({
    fanout,
    reconcile: inertReconcile(),
    mergeability: args.mergeability ?? inertMergeabilityRefresh(),
  })

  return new GithubPrStore({
    mailbox: new GithubPrEventMailboxService(fanout, dispatcher),
    dispatcher,
  })
}
