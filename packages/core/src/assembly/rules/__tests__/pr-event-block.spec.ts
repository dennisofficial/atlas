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

  it('leads an edited comment with its edit', () => {
    const block = prEventBlock(eventOf({ authorLogin: 'octocat', body: 'now fixed', edited: true }))

    expect(block).toContain('comment from octocat edited — now fixed.')
  })

  it('leads an edited review comment with its edit', () => {
    const block = prEventBlock(
      eventOf({
        kind: EPrEventKind.ReviewComment,
        authorLogin: 'octocat',
        body: 'nit',
        edited: true,
      }),
    )

    expect(block).toContain('review comment from octocat edited — nit.')
  })

  it('names a review comment as such', () => {
    const block = prEventBlock(
      eventOf({ kind: EPrEventKind.ReviewComment, authorLogin: 'octocat', body: 'nit' }),
    )

    expect(block).toContain('review comment from octocat — nit.')
  })

  it('places a review comment on its file, lines and diff hunk', () => {
    const block = prEventBlock(
      eventOf({
        kind: EPrEventKind.ReviewComment,
        authorLogin: 'octocat',
        body: 'rename this',
        path: 'src/foo.ts',
        line: 12,
        startLine: 10,
        side: 'RIGHT',
        diffHunk: '@@ -8,3 +8,5 @@\n+const a = 1\n+const b = 2',
        inReplyTo: '55',
      }),
    )

    expect(block).toBe(
      `<system-notice kind="pr-event">\nPR #12 in github.com/owner/repo: review comment from octocat on src/foo.ts:12 (lines 10-12) (reply to comment 55) — rename this. ${URL}\n\`\`\`diff\n@@ -8,3 +8,5 @@\n+const a = 1\n+const b = 2\n\`\`\`\n</system-notice>`,
    )
  })

  it('marks a comment on the removed side of the diff', () => {
    const block = prEventBlock(
      eventOf({
        kind: EPrEventKind.ReviewComment,
        body: 'why drop this',
        path: 'a.ts',
        line: 3,
        side: 'LEFT',
      }),
    )

    expect(block).toContain('review comment on a.ts:3 (old side) — why drop this.')
  })

  it('strips html comments and keeps up to 4000 characters of body', () => {
    const body = `<!-- codex-pull-request-review-summary -->\n${'x'.repeat(3000)}`
    const block = prEventBlock(eventOf({ authorLogin: 'codex', body }))

    expect(block).not.toContain('<!--')
    expect(block).toContain('x'.repeat(3000))
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
    const block = prEventBlock(eventOf({ authorLogin: 'octocat', body: 'x'.repeat(5000) }))

    expect(block).toContain(`${'x'.repeat(3999)}…`)
    expect(block).not.toContain('x'.repeat(4000))
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

describe('naming the checks behind a failed verdict', () => {
  const failed = (over: Partial<EventOfType<'pr-event'>> = {}) =>
    prEventBlock(eventOf({ kind: EPrEventKind.Verdict, verdict: EPrVerdict.Failed, ...over }))

  it('lists each failed check with its app, link, detail and log command', () => {
    const block = failed({
      settled: false,
      repo: 'github.com/owner/repo',
      failedChecks: [
        {
          name: 'typecheck',
          app: 'github-actions',
          url: 'https://github.com/owner/repo/runs/7',
          checkRunId: '7',
        },
        { name: 'vercel', summary: 'Build failed' },
      ],
    })

    expect(block).toContain('2 checks failed while CI is still running')
    expect(block).toContain('- typecheck (github-actions) https://github.com/owner/repo/runs/7')
    expect(block).toContain('    logs: gh run view --job 7 --log-failed -R owner/repo')
    expect(block).toContain('- vercel\n    Build failed')
  })

  it('joins a title and summary on one detail line', () => {
    const block = failed({
      settled: true,
      failedChecks: [{ name: 'lint', title: '3 errors', summary: 'src/a.ts:1 no-unused-vars' }],
    })

    expect(block).toContain(`CI finished, a check failed. ${URL}`)
    expect(block).toContain('    3 errors: src/a.ts:1 no-unused-vars')
  })

  it('lists failure annotations under the check with their location', () => {
    const block = failed({
      settled: true,
      failedChecks: [
        {
          name: 'typecheck',
          app: 'github-actions',
          checkRunId: '7',
          annotations: [
            { path: 'src/a.ts', line: 12, message: "Type 'string' is not assignable to 'number'." },
            { path: 'src/b.ts', message: 'Unused export' },
            { message: 'one or more CI checks did not pass' },
          ],
        },
      ],
    })

    expect(block).toContain(
      [
        '- typecheck (github-actions)',
        "    src/a.ts:12 Type 'string' is not assignable to 'number'.",
        '    src/b.ts Unused export',
        '    one or more CI checks did not pass',
        '    logs: gh run view --job 7 --log-failed -R owner/repo',
      ].join('\n'),
    )
  })

  it('marks a cancelled check and offers no log command for a job that never ran', () => {
    const block = failed({
      settled: true,
      repo: 'github.com/owner/repo',
      failedChecks: [
        {
          name: 'mac-app-rehearsal',
          app: 'github-actions',
          checkRunId: '7',
          conclusion: 'cancelled',
          annotations: [
            { path: '.github', message: 'The job was not acquired by Runner of type hosted' },
          ],
        },
      ],
    })

    expect(block).toContain(
      [
        '- mac-app-rehearsal (github-actions) [cancelled]',
        '    .github The job was not acquired by Runner of type hosted',
      ].join('\n'),
    )
    expect(block).not.toContain('logs:')
  })

  it('marks a timed-out check and keeps its log command', () => {
    const block = failed({
      settled: true,
      repo: 'github.com/owner/repo',
      failedChecks: [
        { name: 'test', app: 'github-actions', checkRunId: '8', conclusion: 'timed_out' },
      ],
    })

    expect(block).toContain('- test (github-actions) [timed out]')
    expect(block).toContain('    logs: gh run view --job 8 --log-failed -R owner/repo')
  })

  it('adds no marker for a plain failure', () => {
    const block = failed({
      settled: true,
      failedChecks: [{ name: 'lint', conclusion: 'failure' }],
    })

    expect(block).toContain('- lint\n')
    expect(block).not.toContain('[')
  })

  it('offers no log command for a check outside GitHub Actions', () => {
    const block = failed({ settled: true, failedChecks: [{ name: 'vercel', checkRunId: '9' }] })

    expect(block).not.toContain('logs:')
  })
})
