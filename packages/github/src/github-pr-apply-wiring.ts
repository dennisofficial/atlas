import type { GithubPrFanoutService } from './github-pr-fanout.service'
import {
  GithubPrEventMailboxService,
  type GithubThreadReplay,
} from './github-pr-event-mailbox.service'
import { GithubPrOutboxDispatcher } from './github-pr-outbox'
import { GithubPrHeldGreen, restHeadSuitesRead, type HeadSuitesRead } from './github-pr-held-green'
import { GithubPrMergeabilityRefresh } from './github-pr-mergeability-refresh'
import { GithubPrReconcile } from './github-pr-reconcile'
import { GithubPrStore } from './github-pr-store'
import type { GithubHttpBudget } from './github-request-budget'
import type { GithubUserReads } from './github-user-reads'

export type PrApplyWiring = {
  mailbox: GithubPrEventMailboxService
  dispatcher: GithubPrOutboxDispatcher
  store: GithubPrStore
}

export function buildPrApplyWiring(args: {
  fanout: GithubPrFanoutService
  replayThread?: GithubThreadReplay
  reads: Pick<GithubUserReads, 'readHeadChecksOf' | 'readPullRequestObservation'>
  budget: GithubHttpBudget
  readSuites?: HeadSuitesRead
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
  let mailbox: GithubPrEventMailboxService | null = null
  const heldGreen = new GithubPrHeldGreen({
    mailbox: () => {
      if (mailbox === null) throw new Error('the pr outbox ran before the wiring built its mailbox')
      return mailbox
    },
    dispatch: (outboxIds) => storeOf().dispatch(outboxIds),
    fillTokenOf: args.fillTokenOf,
    readSuites: args.readSuites ?? restHeadSuitesRead,
    budget: args.budget,
  })
  const dispatcher = new GithubPrOutboxDispatcher({
    fanout: args.fanout,
    reconcile: (run) => reconcile.run(run),
    mergeability: (run) => mergeability.run(run),
    confirmGreen: (run) => heldGreen.run(run),
  })
  mailbox = new GithubPrEventMailboxService(args.fanout, dispatcher, args.replayThread)
  bound = new GithubPrStore({ mailbox, dispatcher })

  return { mailbox, dispatcher, store: bound }
}
