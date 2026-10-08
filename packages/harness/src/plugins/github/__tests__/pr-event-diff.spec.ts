import { describe, expect, it } from 'bun:test'

import { EPrEventKind, EPrVerdict } from '@dltech/atlas-core'

import type { PrEventFrame } from '../../../cloud/pr-event-frame'
import {
  createPollDiffer,
  POLL_EVENT_BODY_CLIP,
  prEventsOfPoll,
  type PollMemory,
} from '../pr-event-diff'
import { EChecksState, EPullRequestState, type PullRequest } from '../pure'
import { aPullRequest } from '../testing'

const REPO = 'github.com/dennisofficial/atlas'

const comment = (id: string, body = 'hello') => ({
  id,
  authorLogin: 'octocat',
  body,
  url: `https://github.com/x/y/pull/42#issuecomment-${id}`,
  createdAt: 't',
})

const diff = (args: { previous?: PollMemory; current: PullRequest }) =>
  prEventsOfPoll({ repo: REPO, previous: args.previous, current: args.current })

const second = (first: PullRequest, next: PullRequest) =>
  diff({ previous: diff({ current: first }).memory, current: next })

const drafts = (result: ReturnType<typeof diff>) => result.events.map((event) => event.draft)

describe('prEventsOfPoll', () => {
  it('emits nothing on the first poll for a key, comments included', () => {
    const first = diff({ current: aPullRequest({ comments: [comment('a')], mergeable: false }) })

    expect(first.events).toEqual([])
  })

  it('emits a verdict once when checks flip, and not again while they hold', () => {
    const running = aPullRequest({ checks: EChecksState.Running })
    const green = aPullRequest({ checks: EChecksState.Passing })

    const flipped = second(running, green)
    expect(drafts(flipped)).toEqual([
      expect.objectContaining({ kind: EPrEventKind.Verdict, verdict: EPrVerdict.Green, prNumber: 42 }),
    ])
    expect(diff({ previous: flipped.memory, current: green }).events).toEqual([])
  })

  it('emits a failed verdict, and nothing on a flip to running', () => {
    const green = aPullRequest({ checks: EChecksState.Passing })

    expect(drafts(second(green, aPullRequest({ checks: EChecksState.Failing })))).toEqual([
      expect.objectContaining({ verdict: EPrVerdict.Failed }),
    ])
    expect(second(green, aPullRequest({ checks: EChecksState.Running })).events).toEqual([])
  })

  it('emits mergeability on a definite change, never from or to unknown alone', () => {
    const unknown = aPullRequest({ mergeable: null })

    expect(drafts(second(unknown, aPullRequest({ mergeable: false })))).toEqual([
      expect.objectContaining({ kind: EPrEventKind.Mergeability, mergeable: false }),
    ])
    expect(second(unknown, aPullRequest({ mergeable: true })).events).toEqual([])
    expect(second(aPullRequest({ mergeable: true }), unknown).events).toEqual([])
    expect(drafts(second(aPullRequest({ mergeable: true }), aPullRequest({ mergeable: false })))).toEqual([
      expect.objectContaining({ mergeable: false }),
    ])
  })

  it('reads true, unknown, false as a conflict and true, unknown, true as nothing', () => {
    const settled = diff({ current: aPullRequest({ mergeable: true }) })
    const recomputing = diff({ previous: settled.memory, current: aPullRequest({ mergeable: null }) })

    expect(diff({ previous: recomputing.memory, current: aPullRequest({ mergeable: false }) }).events).toHaveLength(1)
    expect(diff({ previous: recomputing.memory, current: aPullRequest({ mergeable: true }) }).events).toEqual([])
  })

  it('emits a state draft when the pull request settles', () => {
    const merged: PullRequest = { ...aPullRequest(), state: EPullRequestState.Merged }

    expect(drafts(second(aPullRequest(), merged))).toEqual([
      expect.objectContaining({ kind: EPrEventKind.State, state: 'merged' }),
    ])
  })

  it('emits a new comment once with its gh id and a clipped body, and suppresses replays', () => {
    const long = 'x'.repeat(POLL_EVENT_BODY_CLIP + 500)
    const before = aPullRequest({ comments: [comment('a')] })
    const after = aPullRequest({ comments: [comment('a'), comment('b', long)] })

    const arrived = second(before, after)
    expect(arrived.events).toHaveLength(1)
    expect(arrived.events[0]?.id).toBe('b')
    expect(arrived.events[0]?.draft.kind).toBe(EPrEventKind.Comment)
    expect(arrived.events[0]?.draft.authorLogin).toBe('octocat')
    expect(arrived.events[0]?.draft.body?.length).toBe(POLL_EVENT_BODY_CLIP)
    expect(diff({ previous: arrived.memory, current: after }).events).toEqual([])
  })

  it("does not re-announce a comment that scrolled out of gh's window and back", () => {
    const withA = aPullRequest({ comments: [comment('a')] })
    const gone = second(withA, aPullRequest({ comments: [] }))

    expect(diff({ previous: gone.memory, current: withA }).events).toEqual([])
  })

  it('emits a review with reviewState (not state) and the pull request url', () => {
    const review = { id: 'r1', authorLogin: 'steiza', state: 'CHANGES_REQUESTED', body: 'fix' }

    expect(drafts(second(aPullRequest(), aPullRequest({ reviews: [review] })))).toEqual([
      expect.objectContaining({
        kind: EPrEventKind.Review,
        reviewState: 'changes_requested',
        authorLogin: 'steiza',
        url: 'https://github.com/dennisofficial/atlas/pull/42',
      }),
    ])
  })

  it('drops a pending or dismissed review but still remembers its id', () => {
    const pending = { id: 'r2', authorLogin: 'a', state: 'DISMISSED', body: '' }
    const arrived = second(aPullRequest(), aPullRequest({ reviews: [pending] }))

    expect(arrived.events).toEqual([])
    expect(arrived.memory.seen.has('r2')).toBe(true)
  })
})

describe('createPollDiffer', () => {
  const differ = () => {
    const frames: PrEventFrame[] = []
    const poller = createPollDiffer({
      emit: (frame) => frames.push(frame),
      now: () => new Date('2026-10-08T00:00:00Z'),
    })
    return { frames, poller }
  }

  it('keeps memory per key and emits frames in the SSE shape', () => {
    const { frames, poller } = differ()

    poller.onPolled({ key: 'a', repo: REPO, pullRequest: aPullRequest({ checks: EChecksState.Running }) })
    poller.onPolled({ key: 'b', repo: REPO, pullRequest: aPullRequest({ checks: EChecksState.Passing }) })
    poller.onPolled({ key: 'a', repo: REPO, pullRequest: aPullRequest({ checks: EChecksState.Passing }) })

    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({
      repoFullName: 'dennisofficial/atlas',
      prNumber: 42,
      kind: EPrEventKind.Verdict,
      payload: { verdict: EPrVerdict.Green },
      createdAt: '2026-10-08T00:00:00.000Z',
    })
  })

  it('gives a repeated transition a fresh id so the router does not swallow it', () => {
    const { frames, poller } = differ()
    const poll = (checks: EChecksState) =>
      poller.onPolled({ key: 'a', repo: REPO, pullRequest: aPullRequest({ checks }) })

    poll(EChecksState.Running)
    poll(EChecksState.Passing)
    poll(EChecksState.Failing)
    poll(EChecksState.Passing)

    expect(new Set(frames.map((frame) => frame.id)).size).toBe(3)
  })

  it('uses the gh comment id as the frame id', () => {
    const { frames, poller } = differ()

    poller.onPolled({ key: 'a', repo: REPO, pullRequest: aPullRequest() })
    poller.onPolled({ key: 'a', repo: REPO, pullRequest: aPullRequest({ comments: [comment('IC_1')] }) })

    expect(frames.map((frame) => frame.id)).toEqual(['IC_1'])
  })

  it('drops a repo that is not on github.com rather than inventing a slug', () => {
    const { frames, poller } = differ()

    poller.onPolled({ key: 'a', repo: 'gitlab.com/o/r', pullRequest: aPullRequest({ checks: EChecksState.Running }) })
    poller.onPolled({ key: 'a', repo: 'gitlab.com/o/r', pullRequest: aPullRequest({ checks: EChecksState.Passing }) })

    expect(frames).toEqual([])
  })
})
