import { RecordingDrain } from './testing/drain.fixture'
import { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import type { CheckSuiteShape } from './github-check-suites'
import { GithubPrHeldGreen } from './github-pr-held-green'
import {
  GithubPrOutboxDispatcher,
  type PrHeldGreenRun,
  type PrMergeabilityRun,
  type PrReconcileRun,
} from './github-pr-outbox'
import { GithubPrStore } from './github-pr-store'
import type { GithubHttpBudget } from './github-request-budget'

export function inertReconcile(): PrReconcileRun {
  return async () => undefined
}

export function inertMergeabilityRefresh(): PrMergeabilityRun {
  return async () => undefined
}

export const OPEN_BUDGET: GithubHttpBudget = {
  takeHttpSlot: async () => true,
  blockHttpUntil: async () => undefined,
}

export function inertHeldGreen(): PrHeldGreenRun {
  return async () => undefined
}

export function heldGreenFixture(args: {
  mailbox: () => GithubPrEventMailboxService
  dispatcher: () => GithubPrOutboxDispatcher
  suites?: () => readonly CheckSuiteShape[]
}): PrHeldGreenRun {
  const held = new GithubPrHeldGreen({
    mailbox: args.mailbox,
    dispatch: (outboxIds) => args.dispatcher().dispatch(outboxIds),
    fillTokenOf: async () => 'ghs_fixture',
    readSuites: async () => args.suites?.() ?? [],
    budget: OPEN_BUDGET,
  })
  return (run) => held.run(run)
}

export function storeFixture(
  args: { fanout?: GithubPrFanoutService; mergeability?: PrMergeabilityRun } = {},
): GithubPrStore {
  const fanout = args.fanout ?? new GithubPrFanoutService(new RecordingDrain())
  const dispatcher: GithubPrOutboxDispatcher = new GithubPrOutboxDispatcher({
    fanout,
    reconcile: inertReconcile(),
    mergeability: args.mergeability ?? inertMergeabilityRefresh(),
    confirmGreen: heldGreenFixture({ mailbox: () => mailbox, dispatcher: () => dispatcher }),
  })
  const mailbox = new GithubPrEventMailboxService(fanout, dispatcher)

  return new GithubPrStore({ mailbox, dispatcher })
}
