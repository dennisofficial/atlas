import { describe, expect, it } from 'bun:test'

import { EPrEventKind, EPrReviewState, EPrVerdict, type EventDraft } from '../../../events/body'
import type { EventOfType } from '../../../events/envelope'
import { contextFor, log } from '../../__tests__/log-fixture'
import type { Assembled } from '../../assembled'
import { messagesFromEvents } from '../messages-from-events'
import { prEventBlock } from '../pr-event-block'

const URL = 'https://github.com/owner/repo/pull/12#issuecomment-1'

const eventOf = (over: Partial<EventOfType<'pr-event'>> = {}): EventOfType<'pr-event'> =>
  ({
    id: 'evt_1',
    seq: 1,
    threadId: 'thread_1',
    runId: 'run_1',
    depth: 0,
    at: '2026-10-08T12:00:00.000Z',
    type: 'pr-event',
    repo: 'github.com/owner/repo',
    prNumber: 12,
    kind: EPrEventKind.Comment,
    url: URL,
    ...over,
  }) as EventOfType<'pr-event'>

describe('handing a PR event to the model', () => {
  it('renders a comment with its author, body and link', () => {
    const block = prEventBlock(eventOf({ authorLogin: 'octocat', body: 'please rebase' }))

    expect(block).toBe(
      `<system-notice kind="pr-event">\nPR #12 in github.com/owner/repo: comment from octocat — please rebase. ${URL}\n</system-notice>`,
    )
  })

  it('names a review comment as such', () => {
    const block = prEventBlock(
      eventOf({ kind: EPrEventKind.ReviewComment, authorLogin: 'octocat', body: 'nit' }),
    )

    expect(block).toContain('review comment from octocat — nit.')
  })

  it('carries the review state beside the author', () => {
    const block = prEventBlock(
      eventOf({
        kind: EPrEventKind.Review,
        authorLogin: 'octocat',
        reviewState: EPrReviewState.ChangesRequested,
        body: 'see inline',
      }),
    )

    expect(block).toContain('review from octocat (changes_requested) — see inline.')
  })

  it('renders a comment with no author or body as a bare headline and link', () => {
    expect(prEventBlock(eventOf())).toBe(
      `<system-notice kind="pr-event">\nPR #12 in github.com/owner/repo: comment. ${URL}\n</system-notice>`,
    )
  })

  it('says CI finished with every check passed, without a link', () => {
    const block = prEventBlock(eventOf({ kind: EPrEventKind.Verdict, verdict: EPrVerdict.Green }))

    expect(block).toContain('CI finished, all checks passed.')
    expect(block).not.toContain(URL)
  })

  it('says checks failed and links the PR when it is not known whether CI finished', () => {
    const block = prEventBlock(eventOf({ kind: EPrEventKind.Verdict, verdict: EPrVerdict.Failed }))

    expect(block).toContain(`checks failed. ${URL}`)
  })

  it('says CI finished when a failure arrives after every check completed', () => {
    const block = prEventBlock(
      eventOf({ kind: EPrEventKind.Verdict, verdict: EPrVerdict.Failed, settled: true }),
    )

    expect(block).toContain(`CI finished, checks failed. ${URL}`)
  })

  it('says other checks are still running when a failure arrives mid-run', () => {
    const block = prEventBlock(
      eventOf({ kind: EPrEventKind.Verdict, verdict: EPrVerdict.Failed, settled: false }),
    )

    expect(block).toContain(
      `a check failed while CI is still running; another notice follows when CI finishes. ${URL}`,
    )
  })

  it('names the tip a verdict belongs to by its first seven characters', () => {
    const sha = '0123456789abcdef'
    const green = prEventBlock(
      eventOf({ kind: EPrEventKind.Verdict, verdict: EPrVerdict.Green, headSha: sha }),
    )
    const failed = prEventBlock(
      eventOf({ kind: EPrEventKind.Verdict, verdict: EPrVerdict.Failed, headSha: sha }),
    )

    expect(green).toContain('CI finished, all checks passed on 0123456.')
    expect(failed).toContain(`checks failed on 0123456. ${URL}`)
  })

  it('leaves the tip off a verdict whose sha is absent or shorter than seven characters', () => {
    const absent = prEventBlock(eventOf({ kind: EPrEventKind.Verdict, verdict: EPrVerdict.Green }))
    const short = prEventBlock(
      eventOf({ kind: EPrEventKind.Verdict, verdict: EPrVerdict.Green, headSha: 'abc123' }),
    )

    expect(absent).toContain('all checks passed.')
    expect(short).toContain('all checks passed.')
  })

  it('says whether the PR is mergeable', () => {
    const mergeable = prEventBlock(eventOf({ kind: EPrEventKind.Mergeability, mergeable: true }))
    const conflicted = prEventBlock(eventOf({ kind: EPrEventKind.Mergeability, mergeable: false }))
    const unknown = prEventBlock(eventOf({ kind: EPrEventKind.Mergeability }))

    expect(mergeable).toContain('now mergeable.')
    expect(conflicted).toContain('now has merge conflicts.')
    expect(unknown).toContain('mergeability unknown.')
  })

  it('says a PR merged or closed, and passes any other state through', () => {
    const merged = prEventBlock(eventOf({ kind: EPrEventKind.State, state: 'merged' }))
    const closed = prEventBlock(eventOf({ kind: EPrEventKind.State, state: 'closed' }))
    const reopened = prEventBlock(eventOf({ kind: EPrEventKind.State, state: 'open' }))

    expect(merged).toContain('now merged.')
    expect(closed).toContain('now closed.')
    expect(reopened).toContain('state is now open.')
  })

  it('clips a long body', () => {
    const block = prEventBlock(eventOf({ authorLogin: 'octocat', body: 'x'.repeat(2000) }))

    expect(block).toContain(`${'x'.repeat(399)}…`)
    expect(block).not.toContain('x'.repeat(400))
  })

  it('wraps every kind in the pr-event system notice', () => {
    const blocks = [
      eventOf({ authorLogin: 'octocat', body: 'hello' }),
      eventOf({ kind: EPrEventKind.Review, authorLogin: 'octocat', state: 'approved' }),
      eventOf({ kind: EPrEventKind.Verdict, verdict: EPrVerdict.Failed }),
      eventOf({ kind: EPrEventKind.Mergeability, mergeable: false }),
      eventOf({ kind: EPrEventKind.State, state: 'merged' }),
    ].map(prEventBlock)

    for (const block of blocks) {
      expect(block.startsWith('<system-notice kind="pr-event">')).toBe(true)
      expect(block.endsWith('</system-notice>')).toBe(true)
    }
  })
})

describe('messagesFromEvents and PR events', () => {
  const empty: Assembled = { system: [], messages: [] }

  it('hands a PR event over as a user message in log order, with its origin', () => {
    const drafts: EventDraft[] = [
      { type: 'user-said', text: 'push it' },
      {
        type: 'pr-event',
        repo: 'github.com/owner/repo',
        prNumber: 12,
        kind: EPrEventKind.Verdict,
        url: URL,
        verdict: EPrVerdict.Green,
      },
    ]
    const events = log(drafts)

    const assembled = messagesFromEvents()(empty, contextFor({ events }))

    expect(assembled.messages).toHaveLength(2)
    expect(assembled.messages[1]?.message).toEqual({
      role: 'user',
      content: [
        {
          type: 'text',
          text: '<system-notice kind="pr-event">\nPR #12 in github.com/owner/repo: CI finished, all checks passed.\n</system-notice>',
        },
      ],
    })
    expect(assembled.messages[1]?.origin.seq).toBe(2)
  })
})
