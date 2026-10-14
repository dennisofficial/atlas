import type { BeforeTurn, LinkedPullRequest, OnThreadOpen, ThreadId } from '@dltech/atlas-core'

import { prEventNoticeOf, repoOfFrame, type PrEventDraft, type PrEventFrame } from '../../cloud/pr-event-frame'
import type { FamilyTracker } from './family-tracker'
import type { PrEventNoticeQueue } from './pr-event-queue'
import { checkoutKey, EPullRequestLookup, type RepositoryCheckout } from './pure'
import { createPrEventDedupe, type PrEventDedupe } from './pure/pr-event-dedupe'
import type { PullRequestService } from './pull-request-service'

export type PrEventRouting = {
  onPrEvent: (frame: PrEventFrame) => void
  beforeTurn: BeforeTurn
  threadOpened: OnThreadOpen
}

const repoOfCheckout = (checkout: RepositoryCheckout): string =>
  `${checkout.remote.host}/${checkout.remote.owner}/${checkout.remote.repo}`

/**
 * A notice belongs to the thread standing on the pull request's checkout, so a teammate's CI result
 * reaches the teammate rather than the thread the operator happens to be looking at. Two cases have
 * no such owner, and the session's visible thread is the fallback for both: a linked pull request
 * whose linking thread is unknown, and the window before the first turn has named any thread. Frames
 * with no owner and no visible thread yet are held rather than dropped, since dedupe has already
 * admitted them. `OnThreadOpen` names the visible thread whenever the conversation changes; a serve
 * process never fires that phase, so the first `BeforeTurn` stands in.
 */
export function createPrEventRouting(args: {
  service: PullRequestService
  tracker: FamilyTracker
  links: () => readonly LinkedPullRequest[]
  queue: PrEventNoticeQueue
  dedupe?: PrEventDedupe
}): PrEventRouting {
  const dedupe = args.dedupe ?? createPrEventDedupe()
  const held: PrEventDraft[] = []

  let threadId: ThreadId | null = null

  const standingKeys = (target: { repo: string; prNumber: number }): readonly string[] =>
    args.service.tracked().flatMap((checkout) => {
      if (repoOfCheckout(checkout) !== target.repo) return []

      const key = checkoutKey(checkout)
      const reading = args.service.snapshot({ key })
      if (reading.lookup !== EPullRequestLookup.Found) return []
      return reading.pullRequest.number === target.prNumber ? [key] : []
    })

  const owners = (target: { repo: string; prNumber: number }): readonly ThreadId[] => [
    ...new Set(standingKeys(target).flatMap((key) => args.tracker.threadsOn({ key }))),
  ]

  const linkOf = (target: { repo: string; prNumber: number }): LinkedPullRequest | undefined =>
    args.links().find((link) => link.repo === target.repo && link.number === target.prNumber)

  const deliver = (draft: PrEventDraft): void => {
    const owning = owners(draft)
    if (owning.length > 0) {
      for (const owner of owning) args.queue.queue({ threadId: owner, draft })
      return
    }

    const target = linkOf(draft)?.linkedBy ?? threadId
    if (target === null) {
      held.push(draft)
      return
    }
    args.queue.queue({ threadId: target, draft })
  }

  const adopt = (opened: ThreadId): void => {
    if (threadId !== null) args.queue.reassign({ from: threadId, to: opened })
    threadId = opened
    for (const draft of held.splice(0)) deliver(draft)
  }

  const watching = (frame: PrEventFrame): boolean => {
    const target = { repo: repoOfFrame(frame), prNumber: frame.prNumber }
    return standingKeys(target).length > 0 || linkOf(target) !== undefined
  }

  return {
    onPrEvent: (frame) => {
      if (!watching(frame)) return

      const draft = prEventNoticeOf(frame)
      const fresh = dedupe.admit({
        id: frame.id,
        repo: draft.repo,
        prNumber: frame.prNumber,
        kind: frame.kind,
        verdict: draft.verdict,
        mergeable: draft.mergeable,
        state: draft.state,
      })
      if (fresh) deliver(draft)
    },
    beforeTurn: async ({ threadId: running }) => {
      if (threadId === null) adopt(running)
      return {}
    },
    threadOpened: async ({ threadId: opened }) => {
      adopt(opened)
      return {}
    },
  }
}
