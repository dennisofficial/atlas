import { EPrEventKind, EPrReviewState, EPrVerdict, type ThreadId } from '@dltech/atlas-core'

import { prEventNoticeOf, repoOfFrame, type PrEventFrame } from '../../cloud/pr-event-frame'
import {
  EOccurrenceUrgency,
  type SubscriptionOccurrence,
  type SubscriptionProvider,
} from '../../subscriptions/provider'
import { probeCheckout } from './checkout-probe'
import type { FamilyTracker } from './family-tracker'
import {
  checkoutKey,
  EPullRequestLookup,
  EPullRequestState,
  type PullRequestReading,
  type RepositoryCheckout,
} from './pure'
import { pullRequestLinkKey } from './links'
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

const GITHUB_PREFIX = 'github.com/'

const now = (args: {
  draft: SubscriptionOccurrence['draft']
  key: string
}): SubscriptionOccurrence => ({
  key: args.key,
  urgency: EOccurrenceUrgency.Now,
  draft: args.draft,
})

const batch = (args: {
  draft: SubscriptionOccurrence['draft']
  key: string
  settles?: boolean
}): SubscriptionOccurrence => ({
  key: args.key,
  urgency: EOccurrenceUrgency.Batch,
  draft: args.draft,
  ...(args.settles === undefined ? {} : { settles: args.settles }),
})

export function occurrenceOf(frame: PrEventFrame): SubscriptionOccurrence {
  const draft = prEventNoticeOf(frame)
  const { payload } = frame

  if (frame.kind === EPrEventKind.Review && payload.reviewState === EPrReviewState.Approved) {
    return batch({ draft, key: `review:${payload.authorLogin ?? 'unknown'}` })
  }
  if (frame.kind === EPrEventKind.Verdict) {
    return payload.verdict === EPrVerdict.Green
      ? batch({ draft, key: 'verdict', settles: true })
      : now({ draft, key: 'verdict' })
  }
  if (frame.kind === EPrEventKind.Mergeability) return batch({ draft, key: 'mergeability' })
  if (frame.kind === EPrEventKind.State) {
    const terminal = payload.state === 'merged' || payload.state === 'closed'
    return terminal
      ? { ...now({ draft, key: 'state' }), ends: true }
      : batch({ draft, key: 'state' })
  }
  return now({ draft, key: frame.id })
}

const SETTLED_READING_STATES: ReadonlySet<EPullRequestState> = new Set([
  EPullRequestState.Merged,
  EPullRequestState.Closed,
])

const settledFrameOf = (args: {
  target: PullRequestTarget
  reading: PullRequestReading
}): PrEventFrame | null => {
  const { reading, target } = args
  if (reading.lookup !== EPullRequestLookup.Found) return null

  const { pullRequest } = reading
  if (!SETTLED_READING_STATES.has(pullRequest.state)) return null

  return {
    id: `reading:${targetKey(target)}:${pullRequest.state}`,
    repoFullName: target.repo.slice(GITHUB_PREFIX.length),
    prNumber: target.number,
    kind: EPrEventKind.State,
    payload: { url: pullRequest.url, state: pullRequest.state },
    createdAt: '',
  }
}

export function createPullRequestProvider(args: {
  tracker: Pick<FamilyTracker, 'checkoutFor'>
  service: Pick<PullRequestService, 'snapshot' | 'subscribe' | 'refresh'>
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

  const foundNumberAfterFreshRead = async (
    checkout: RepositoryCheckout,
  ): Promise<number | null> => {
    const held = foundNumber(checkout)
    if (held !== null) return held

    await args.service.refresh({ checkout, force: true })
    return foundNumber(checkout)
  }

  const ended = new Set<string>()
  let unlisten: (() => void) | null = null

  const deliver = (args: { key: string; occurrence: SubscriptionOccurrence }): void => {
    for (const [id, emit] of [...(emitters.get(args.key)?.entries() ?? [])]) {
      if (ended.has(id)) continue
      if (args.occurrence.ends === true) ended.add(id)
      emit(args.occurrence)
    }
  }

  const sweep = (): void => {
    for (const [key, target] of [...targets]) {
      const frame = settledFrameOf({
        target,
        reading: args.service.snapshot({ key: pullRequestLinkKey(target) }),
      })
      if (frame !== null) deliver({ key, occurrence: occurrenceOf(frame) })
    }
  }

  const listen = (): void => {
    if (unlisten === null) unlisten = args.service.subscribe(sweep)
  }

  const unlistenWhenIdle = (): void => {
    if (targets.size > 0) return

    unlisten?.()
    unlisten = null
  }

  return {
    kind: PULL_REQUEST_PROVIDER_KIND,
    summary: 'Pull request events: comments, reviews, CI verdicts, mergeability, merge or close.',
    targetHint:
      'Blank for this checkout\u2019s pull request, or #123, owner/repo#123, or a github.com pull request URL.',
    resolve: async ({ input, threadId, projectDirectory }) => {
      const checkout = await checkoutOf({ threadId, projectDirectory })
      const blank = input.trim().length === 0
      const found =
        checkout === null
          ? null
          : blank
            ? await foundNumberAfterFreshRead(checkout)
            : foundNumber(checkout)

      return resolveSubscriptionTarget({ input, checkout, foundNumber: found })
    },
    start: ({ subscription, emit }) => {
      const target = targetOf(subscription.target)
      if (target === null) return () => undefined

      const key = targetKey(target)
      const holders = emitters.get(key) ?? new Map<string, Emit>()
      holders.set(subscription.id, emit)
      emitters.set(key, holders)
      targets.set(key, target)
      listen()
      publish()
      sweep()

      return () => {
        holders.delete(subscription.id)
        ended.delete(subscription.id)
        if (holders.size > 0) return

        emitters.delete(key)
        targets.delete(key)
        unlistenWhenIdle()
        publish()
      }
    },
    subscribed: (target) => emitters.has(targetKey(target)),
    onFrame: (frame) => {
      const key = targetKey({ repo: repoOfFrame(frame), number: frame.prNumber })
      if (!emitters.has(key)) return

      const draft = prEventNoticeOf(frame)
      const fresh = dedupe.admit({
        id: frame.id,
        repo: draft.repo.toLowerCase(),
        prNumber: frame.prNumber,
        kind: frame.kind,
        verdict: draft.verdict,
        headSha: draft.headSha,
        mergeable: draft.mergeable,
        state: draft.state,
      })
      if (!fresh) return

      deliver({ key, occurrence: occurrenceOf(frame) })
    },
  }
}
