import {
  EPrEventKind,
  ESubscriptionActor,
  ESubscriptionStatus,
  toThreadId,
  type Subscription,
} from '@dltech/atlas-core'

import type { PrEventFrame } from '../../../cloud/pr-event-frame'
import type { SubscriptionOccurrence } from '../../../subscriptions/provider'
import { createPullRequestProvider, PULL_REQUEST_PROVIDER_KIND } from '../pull-request-provider'
import { createPullRequestService } from '../pull-request-service'
import type { PullRequestTarget } from '../subscription-target'
import { pullRequestsAnswering, wasFound } from '../testing'

export const THREAD = toThreadId('thread-1')
export const REPO = 'github.com/dennisofficial/atlas'
export const TARGET = { repo: REPO, number: 42 }

let sequence = 0
export const frame = (args: {
  kind: EPrEventKind
  prNumber?: number
  id?: string
  repoFullName?: string
  payload?: Partial<PrEventFrame['payload']>
}): PrEventFrame => {
  sequence += 1
  return {
    id: args.id ?? `frame-${sequence}`,
    repoFullName: args.repoFullName ?? 'dennisofficial/atlas',
    prNumber: args.prNumber ?? 42,
    kind: args.kind,
    payload: { url: 'https://github.com/dennisofficial/atlas/pull/42', ...args.payload },
    createdAt: 't',
  }
}

export const subscription = (args?: { id?: string; target?: unknown }): Subscription => ({
  id: args?.id ?? 'sub-1',
  provider: PULL_REQUEST_PROVIDER_KIND,
  target: (args?.target ?? TARGET) as Subscription['target'],
  label: 'dennisofficial/atlas#42',
  threadId: THREAD,
  createdBy: ESubscriptionActor.Agent,
  status: ESubscriptionStatus.Active,
  createdAt: 't',
})

export const harness = () => {
  const targets: (readonly PullRequestTarget[])[] = []
  const service = createPullRequestService({ pullRequests: pullRequestsAnswering(wasFound()) })
  const provider = createPullRequestProvider({
    tracker: { checkoutFor: () => null },
    service,
    onTargets: (next) => targets.push(next),
    probe: async () => null,
  })
  const emitted: SubscriptionOccurrence[] = []
  const started = (args?: Parameters<typeof subscription>[0]) =>
    provider.start({ subscription: subscription(args), emit: (o) => emitted.push(o) })

  return { provider, emitted, targets, started, service }
}
