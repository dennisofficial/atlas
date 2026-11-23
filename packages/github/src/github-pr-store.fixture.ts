import { inertSignals } from './testing/thread-signals.fixture'
import { RecordingDrain } from './testing/drain.fixture'
import { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import {
  GithubPrOutboxDispatcher,
  type PrMergeabilityRun,
  type PrReconcileRun,
} from './github-pr-outbox'
import { GithubPrStore } from './github-pr-store'
import type { WakeStub } from './github-legacy-effects.fixture'
import { legacyOf } from './github-legacy-effects.fixture'

export function inertWake(): WakeStub {
  return { notifyEvent: async () => undefined } as unknown as WakeStub
}

export function inertReconcile(): PrReconcileRun {
  return async () => undefined
}

export function inertMergeabilityRefresh(): PrMergeabilityRun {
  return async () => undefined
}

export function storeFixture(
  args: { fanout?: GithubPrFanoutService; wake?: WakeStub; mergeability?: PrMergeabilityRun } = {},
): GithubPrStore {
  const fanout = args.fanout ?? new GithubPrFanoutService(new RecordingDrain())
  const wake = args.wake ?? inertWake()
  const dispatcher = new GithubPrOutboxDispatcher({
    fanout,
    legacy: legacyOf({ signals: inertSignals(), wake: wake }),
    reconcile: inertReconcile(),
    mergeability: args.mergeability ?? inertMergeabilityRefresh(),
  })

  return new GithubPrStore({
    mailbox: new GithubPrEventMailboxService(fanout, dispatcher),
    dispatcher,
  })
}
