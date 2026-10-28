import { EPrEventKind, EPrReviewState, EPrVerdict, type ThreadId } from '@dltech/atlas-core'

import { prEventNoticeOf, repoOfFrame, type PrEventFrame } from '../../cloud/pr-event-frame'
import {
  EOccurrenceUrgency,
  type SubscriptionOccurrence,
  type SubscriptionProvider,
} from '../../subscriptions/provider'
import { probeCheckout } from './checkout-probe'
import type { FamilyTracker } from './family-tracker'
import { checkoutKey, EPullRequestLookup, type RepositoryCheckout } from './pure'
import { createPrEventDedupe } from './pure/pr-event-dedupe'
import type { PullRequestService } from './pull-request-service'
import {
  resolveSubscriptionTarget,
  targetKey,
  targetOf,
  type PullRequestTarget,
} from './subscription-target'

export const PULL_REQUEST_PROVIDER_KIND = 'github.pull-request'

export type PullRequestProvider = SubscriptionProvider & {
  onFrame: (frame: PrEventFrame) => void
  subscribed: (args: { repo: string; number: number }) => boolean
}

type Emit = (occurrence: SubscriptionOccurrence) => void

const now = (draft: SubscriptionOccurrence['draft'], key: string): SubscriptionOccurrence => ({
  key,
  urgency: EOccurrenceUrgency.Now,
  draft,
})

const batch = (
  draft: SubscriptionOccurrence['draft'],
  key: string,
  rest?: { settles?: boolean },
): SubscriptionOccurrence => ({ key, urgency: EOccurrenceUrgency.Batch, draft, ...rest })

export function occurrenceOf(frame: PrEventFrame): SubscriptionOccurrence {
  const draft = prEventNoticeOf(frame)
  const { payload } = frame

  if (frame.kind === EPrEventKind.Review && payload.reviewState === EPrReviewState.Approved) {
    return batch(draft, `review:${payload.authorLogin ?? 'unknown'}`)
  }
  if (frame.kind === EPrEventKind.Verdict) {
    return payload.verdict === EPrVerdict.Green
      ? batch(draft, 'verdict', { settles: true })
      : now(draft, 'verdict')
  }
  if (frame.kind === EPrEventKind.Mergeability) return batch(draft, 'mergeability')
  if (frame.kind === EPrEventKind.State) {
    const terminal = payload.state === 'merged' || payload.state === 'closed'
    return terminal ? { ...now(draft, 'state'), ends: true } : batch(draft, 'state')
  }
  return now(draft, frame.id)
}

export function createPullRequestProvider(args: {
  tracker: Pick<FamilyTracker, 'checkoutFor'>
  service: Pick<PullRequestService, 'snapshot'>
  onTargets: (targets: readonly PullRequestTarget[]) => void
  probe?: typeof probeCheckout
}): PullRequestProvider {
  const probe = args.probe ?? probeCheckout
  const dedupe = createPrEventDedupe()
  const emitters = new Map<string, Map<string, Emit>>()
  const targets = new Map<string, PullRequestTarget>()

  const publish = (): void => args.onTargets([...targets.values()])

  const checkoutOf = async (request: {
    threadId: ThreadId
    projectDirectory: string
  }): Promise<RepositoryCheckout | null> =>
    args.tracker.checkoutFor({ threadId: request.threadId }) ??
    (await probe({ directory: request.projectDirectory }))

  const foundNumber = (checkout: RepositoryCheckout): number | null => {
    const reading = args.service.snapshot({ key: checkoutKey(checkout) })
    return reading.lookup === EPullRequestLookup.Found ? reading.pullRequest.number : null
  }

  return {
    kind: PULL_REQUEST_PROVIDER_KIND,
    summary: 'Pull request events: comments, reviews, CI verdicts, mergeability, merge or close.',
    targetHint:
      'Blank for this checkout\u2019s pull request, or #123, owner/repo#123, or a github.com pull request URL.',
    resolve: async ({ input, threadId, projectDirectory }) => {
      const checkout = await checkoutOf({ threadId, projectDirectory })
      return resolveSubscriptionTarget({
        input,
        checkout,
        foundNumber: checkout === null ? null : foundNumber(checkout),
      })
    },
    start: ({ subscription, emit }) => {
      const target = targetOf(subscription.target)
      if (target === null) return () => undefined

      const key = targetKey(target)
      const holders = emitters.get(key) ?? new Map<string, Emit>()
      holders.set(subscription.id, emit)
      emitters.set(key, holders)
      targets.set(key, target)
      publish()

      return () => {
        holders.delete(subscription.id)
        if (holders.size > 0) return

        emitters.delete(key)
        targets.delete(key)
        publish()
      }
    },
    subscribed: (target) => emitters.has(targetKey(target)),
    onFrame: (frame) => {
      const holders = emitters.get(targetKey({ repo: repoOfFrame(frame), number: frame.prNumber }))
      if (holders === undefined) return

      const draft = prEventNoticeOf(frame)
      const fresh = dedupe.admit({
        id: frame.id,
        repo: draft.repo,
        prNumber: frame.prNumber,
        kind: frame.kind,
        verdict: draft.verdict,
        headSha: draft.headSha,
        mergeable: draft.mergeable,
        state: draft.state,
      })
      if (!fresh) return

      const occurrence = occurrenceOf(frame)
      for (const emit of [...holders.values()]) emit(occurrence)
    },
  }
}
