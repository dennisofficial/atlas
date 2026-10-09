import { EPrEventKind, EPrReviewState, EPrVerdict } from '@dltech/atlas-core'

import type { PrEventDraft, PrEventFrame } from '../../cloud/pr-event-frame'

import { EChecksState, type PrComment, type PrReview, type PullRequest } from './pure'

export const POLL_EVENT_BODY_CLIP = 1_000
export const SEEN_ID_LIMIT = 100

export type PollMemory = {
  pullRequest: PullRequest
  mergeable: boolean | null
  seen: ReadonlySet<string>
}

export type PollEvent = { id: string | null; draft: PrEventDraft }

export type PollDiff = { events: readonly PollEvent[]; memory: PollMemory }

const clip = (text: string): string =>
  text.length <= POLL_EVENT_BODY_CLIP ? text : `${text.slice(0, POLL_EVENT_BODY_CLIP - 1)}…`

const verdictOf = (checks: EChecksState): EPrVerdict | null => {
  if (checks === EChecksState.Passing) return EPrVerdict.Green
  if (checks === EChecksState.Failing) return EPrVerdict.Failed
  return null
}

const verdictDrafts = (args: {
  repo: string
  previous: PullRequest
  current: PullRequest
}): readonly PrEventDraft[] => {
  if (args.previous.checks === args.current.checks) return []

  const verdict = verdictOf(args.current.checks)
  if (verdict === null) return []

  return [
    {
      type: 'pr-event',
      repo: args.repo,
      prNumber: args.current.number,
      kind: EPrEventKind.Verdict,
      url: args.current.url,
      verdict,
    },
  ]
}

/**
 * Compared against the last definite value rather than the previous reading: GitHub answers
 * `UNKNOWN` while it recomputes after a push, so true → unknown → false is still a conflict, and
 * unknown → true is the recompute settling, not news.
 */
const mergeabilityDrafts = (args: {
  repo: string
  remembered: boolean | null
  current: PullRequest
}): readonly PrEventDraft[] => {
  const { mergeable } = args.current
  if (mergeable === null || mergeable === args.remembered) return []
  if (args.remembered === null && mergeable) return []

  return [
    {
      type: 'pr-event',
      repo: args.repo,
      prNumber: args.current.number,
      kind: EPrEventKind.Mergeability,
      url: args.current.url,
      mergeable,
    },
  ]
}

const stateDrafts = (args: {
  repo: string
  previous: PullRequest
  current: PullRequest
}): readonly PrEventDraft[] => {
  if (args.previous.state === args.current.state) return []

  return [
    {
      type: 'pr-event',
      repo: args.repo,
      prNumber: args.current.number,
      kind: EPrEventKind.State,
      url: args.current.url,
      state: args.current.state,
    },
  ]
}

const commentDraft = (args: { repo: string; number: number; comment: PrComment }): PrEventDraft => ({
  type: 'pr-event',
  repo: args.repo,
  prNumber: args.number,
  kind: EPrEventKind.Comment,
  url: args.comment.url,
  ...(args.comment.authorLogin === null ? {} : { authorLogin: args.comment.authorLogin }),
  body: clip(args.comment.body),
})

const REVIEW_STATES: Record<string, EPrReviewState> = {
  APPROVED: EPrReviewState.Approved,
  CHANGES_REQUESTED: EPrReviewState.ChangesRequested,
  COMMENTED: EPrReviewState.Commented,
}

/** `PENDING` and `DISMISSED` are not news the model can act on, so they produce no draft. */
const reviewDraft = (args: {
  repo: string
  number: number
  url: string
  review: PrReview
}): PrEventDraft | null => {
  const reviewState = REVIEW_STATES[args.review.state]
  if (reviewState === undefined) return null

  return {
    type: 'pr-event',
    repo: args.repo,
    prNumber: args.number,
    kind: EPrEventKind.Review,
    url: args.url,
    reviewState,
    ...(args.review.authorLogin === null ? {} : { authorLogin: args.review.authorLogin }),
    body: clip(args.review.body),
  }
}

const idsOf = (pullRequest: PullRequest): readonly string[] => [
  ...pullRequest.comments.map((comment) => comment.id),
  ...pullRequest.reviews.map((review) => review.id),
]

const remembering = (args: { seen: ReadonlySet<string>; ids: readonly string[] }): Set<string> => {
  const merged = new Set([...args.seen, ...args.ids])
  return new Set([...merged].slice(-SEEN_ID_LIMIT))
}

const untagged = (drafts: readonly PrEventDraft[]): PollEvent[] =>
  drafts.map((draft) => ({ id: null, draft }))

/**
 * The first reading for a key emits nothing — there is nothing to transition from, and a session
 * that starts polling must not replay the pull request's history as notices — but it does record
 * the ids already on the page so they stay quiet afterwards.
 */
export function prEventsOfPoll(args: {
  repo: string
  previous: PollMemory | undefined
  current: PullRequest
}): PollDiff {
  const { previous, current, repo } = args
  const memory: PollMemory = {
    pullRequest: current,
    mergeable: current.mergeable ?? previous?.mergeable ?? null,
    seen: remembering({ seen: previous?.seen ?? new Set(), ids: idsOf(current) }),
  }
  if (previous === undefined) return { events: [], memory }

  const fresh = (id: string): boolean => !previous.seen.has(id)
  const events: PollEvent[] = [
    ...untagged(verdictDrafts({ repo, previous: previous.pullRequest, current })),
    ...untagged(mergeabilityDrafts({ repo, remembered: previous.mergeable, current })),
    ...untagged(stateDrafts({ repo, previous: previous.pullRequest, current })),
    ...current.comments
      .filter((comment) => fresh(comment.id))
      .map((comment) => ({
        id: comment.id,
        draft: commentDraft({ repo, number: current.number, comment }),
      })),
    ...current.reviews
      .filter((review) => fresh(review.id))
      .flatMap((review) => {
        const draft = reviewDraft({ repo, number: current.number, url: current.url, review })
        return draft === null ? [] : [{ id: review.id, draft }]
      }),
  ]
  return { events, memory }
}

const GITHUB_PREFIX = 'github.com/'

const frameOf = (args: { id: string; event: PollEvent; createdAt: string }): PrEventFrame | null => {
  const { draft } = args.event
  if (!draft.repo.startsWith(GITHUB_PREFIX)) return null

  return {
    id: args.id,
    repoFullName: draft.repo.slice(GITHUB_PREFIX.length),
    prNumber: draft.prNumber,
    kind: draft.kind,
    payload: {
      url: draft.url,
      authorLogin: draft.authorLogin,
      body: draft.body,
      verdict: draft.verdict,
      mergeable: draft.mergeable,
      state: draft.state,
      reviewState: draft.reviewState,
    },
    createdAt: args.createdAt,
  }
}

/**
 * Poll diffs enter as the same frames the SSE stream delivers, so the router's watch filter,
 * thread handling and dedupe apply to both sources and nothing downstream knows which spoke.
 * Transition frames take a sequence id — a green that follows a failed that followed a green is
 * three notices, and a fixed id would let the id dedupe swallow the third.
 */
export function createPollDiffer(args: { emit: (frame: PrEventFrame) => void; now?: () => Date }): {
  onPolled: (polled: { key: string; repo: string; pullRequest: PullRequest }) => void
} {
  const memories = new Map<string, PollMemory>()
  const now = args.now ?? (() => new Date())
  let sequence = 0

  return {
    onPolled: ({ key, repo, pullRequest }) => {
      const diff = prEventsOfPoll({ repo, previous: memories.get(key), current: pullRequest })
      memories.set(key, diff.memory)

      for (const event of diff.events) {
        sequence += 1
        const frame = frameOf({
          id: event.id ?? `poll:${key}:${event.draft.kind}:${sequence}`,
          event,
          createdAt: now().toISOString(),
        })
        if (frame !== null) args.emit(frame)
      }
    },
  }
}
