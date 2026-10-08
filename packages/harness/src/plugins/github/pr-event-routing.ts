import type { BeforeTurn, LinkedPullRequest, OnThreadOpen, ThreadId } from '@dltech/atlas-core'

import { prEventNoticeOf, repoOfFrame, type PrEventDraft, type PrEventFrame } from '../../cloud/pr-event-frame'
import type { PrEventNoticeQueue } from './pr-event-queue'
import { EPullRequestLookup } from './pure'
import { createPrEventDedupe, type PrEventDedupe } from './pure/pr-event-dedupe'
import type { PullRequestService } from './pull-request-service'

export type PrEventRouting = {
  onPrEvent: (frame: PrEventFrame) => void
  beforeTurn: BeforeTurn
  threadOpened: OnThreadOpen
}

const trackedPullRequest = (service: PullRequestService): { repo: string; number: number } | null => {
  const tracked = service.current()
  if (tracked === null || tracked.reading.lookup !== EPullRequestLookup.Found) return null

  const { remote } = tracked.checkout
  return {
    repo: `${remote.host}/${remote.owner}/${remote.repo}`,
    number: tracked.reading.pullRequest.number,
  }
}

/**
 * The session's main thread is the one notices are keyed to. `OnThreadOpen` names it whenever the
 * visible conversation changes; a serve process never fires that phase, so the first `BeforeTurn`
 * stands in — no child agent can exist before the main thread has taken a turn. Frames that arrive
 * before either has fired are held rather than dropped, since dedupe has already admitted them.
 */
export function createPrEventRouting(args: {
  service: PullRequestService
  links: () => readonly LinkedPullRequest[]
  queue: PrEventNoticeQueue
  dedupe?: PrEventDedupe
}): PrEventRouting {
  const dedupe = args.dedupe ?? createPrEventDedupe()
  const held: PrEventDraft[] = []

  let threadId: ThreadId | null = null

  const deliver = (draft: PrEventDraft): void => {
    if (threadId === null) {
      held.push(draft)
      return
    }
    args.queue.queue({ threadId, draft })
  }

  const adopt = (opened: ThreadId): void => {
    if (threadId !== null) args.queue.reassign({ from: threadId, to: opened })
    threadId = opened
    for (const draft of held.splice(0)) deliver(draft)
  }

  const watching = (frame: PrEventFrame): boolean => {
    const repo = repoOfFrame(frame)
    const tracked = trackedPullRequest(args.service)
    if (tracked?.repo === repo && tracked.number === frame.prNumber) return true

    return args.links().some((link) => link.repo === repo && link.number === frame.prNumber)
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
