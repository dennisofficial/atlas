import { describe, expect, it } from 'bun:test'

import { EMergeQueueMove, EPrEventKind, EPrVerdict, type EventOfType } from '@dltech/atlas-core'

import { prEventFailed, prEventLine } from '../pr-event-line'

const verdict = (over: Partial<EventOfType<'pr-event'>>): EventOfType<'pr-event'> =>
  ({
    id: 'evt_1',
    seq: 1,
    threadId: 'thread_1',
    runId: 'run_1',
    depth: 0,
    at: '2026-11-04T12:00:00.000Z',
    type: 'pr-event',
    repo: 'github.com/owner/repo',
    prNumber: 794,
    kind: EPrEventKind.Verdict,
    url: 'https://github.com/owner/repo/pull/794',
    verdict: EPrVerdict.Failed,
    ...over,
  }) as EventOfType<'pr-event'>

const named = (...names: string[]) => names.map((name) => ({ name }))

describe('a merge conflict line', () => {
  it('names the base branch the pull request now conflicts with', () => {
    expect(
      prEventLine(
        verdict({ kind: EPrEventKind.Mergeability, mergeable: false, baseBranch: 'main' }),
      ),
    ).toBe('PR #794: now has merge conflicts with main')
  })

  it('says only that it conflicts when the base branch is not in the event', () => {
    expect(prEventLine(verdict({ kind: EPrEventKind.Mergeability, mergeable: false }))).toBe(
      'PR #794: now has merge conflicts',
    )
  })
})

describe('a failed verdict line', () => {
  it('names the failed checks while CI runs', () => {
    expect(
      prEventLine(verdict({ settled: false, failedChecks: named('typecheck', 'vercel') })),
    ).toBe('PR #794: typecheck, vercel failed, CI still running')
  })

  it('says when a failed check was cancelled rather than failing', () => {
    expect(
      prEventLine(
        verdict({
          settled: true,
          failedChecks: [{ name: 'mac-app-rehearsal', conclusion: 'cancelled' }, { name: 'ci' }],
        }),
      ),
    ).toBe('PR #794: CI finished, mac-app-rehearsal (cancelled), ci failed')
  })

  it('names the failed checks once CI finishes', () => {
    expect(prEventLine(verdict({ settled: true, failedChecks: named('lint') }))).toBe(
      'PR #794: CI finished, lint failed',
    )
  })

  it('counts the checks past the first three', () => {
    expect(
      prEventLine(verdict({ settled: true, failedChecks: named('a', 'b', 'c', 'd', 'e') })),
    ).toBe('PR #794: CI finished, a, b, c +2 more failed')
  })

  it('keeps the generic line when no checks are named', () => {
    expect(prEventLine(verdict({ settled: false }))).toBe(
      'PR #794: a check failed, CI still running',
    )
  })
})

describe('a green verdict line', () => {
  it('says the pull request is mergeable when the verdict closed CI with it', () => {
    expect(
      prEventLine(verdict({ verdict: EPrVerdict.Green, settled: true, mergeable: true })),
    ).toBe('PR #794: CI green, mergeable')
  })

  it('says only that CI is green when mergeability is not in the verdict', () => {
    expect(prEventLine(verdict({ verdict: EPrVerdict.Green, settled: true }))).toBe(
      'PR #794: CI green',
    )
  })
})

describe('a review comment line', () => {
  const comment = (over: Partial<EventOfType<'pr-event'>>) =>
    verdict({
      kind: EPrEventKind.ReviewComment,
      verdict: undefined,
      authorLogin: 'octocat',
      ...over,
    })

  it('names the file and line', () => {
    expect(
      prEventLine(comment({ path: 'src/foo.ts', line: 12, body: 'rename this\nand that' })),
    ).toBe('PR #794: octocat commented on src/foo.ts:12 — rename this')
  })

  it('falls back to the plain wording without a location', () => {
    expect(prEventLine(comment({ body: 'nit' }))).toBe(
      'PR #794: octocat left an inline review comment — nit',
    )
  })

  it('clips a long first line to 119 characters and an ellipsis', () => {
    expect(prEventLine(comment({ kind: EPrEventKind.Comment, body: 'y'.repeat(200) }))).toBe(
      `PR #794: octocat commented — ${'y'.repeat(119)}…`,
    )
  })

  it('keeps a first line of exactly 120 characters whole', () => {
    expect(prEventLine(comment({ kind: EPrEventKind.Comment, body: 'y'.repeat(120) }))).toBe(
      `PR #794: octocat commented — ${'y'.repeat(120)}`,
    )
  })

  it('skips a leading html comment', () => {
    expect(
      prEventLine(
        comment({
          kind: EPrEventKind.Comment,
          body: '<!-- codex-pull-request-review-summary -->\n### Codex Review',
        }),
      ),
    ).toBe('PR #794: octocat commented — ### Codex Review')
  })
})

describe('an auto-merge off line', () => {
  it('says auto-merge turned off, with the reason GitHub gave', () => {
    expect(
      prEventLine(
        verdict({
          kind: EPrEventKind.AutoMergeOff,
          reason: 'Repository rule violations found',
        }),
      ),
    ).toBe('PR #794: auto-merge turned off, Repository rule violations found')
    expect(prEventLine(verdict({ kind: EPrEventKind.AutoMergeOff }))).toBe(
      'PR #794: auto-merge turned off',
    )
  })

  it('marks the line as needing attention', () => {
    expect(prEventFailed(verdict({ kind: EPrEventKind.AutoMergeOff }))).toBe(true)
    expect(prEventFailed(verdict({ kind: EPrEventKind.MergeQueue }))).toBe(false)
  })
})

describe('a CI restarted line', () => {
  it('says CI started again and needs no attention', () => {
    const event = verdict({ kind: EPrEventKind.CiRestarted, verdict: undefined })

    expect(prEventLine(event)).toBe('PR #794: CI started again')
    expect(prEventFailed(event)).toBe(false)
  })
})

describe('a merge queue line', () => {
  it('says the PR entered or left the queue', () => {
    expect(
      prEventLine(verdict({ kind: EPrEventKind.MergeQueue, queue: EMergeQueueMove.Entered })),
    ).toBe('PR #794: entered the merge queue')
    expect(
      prEventLine(verdict({ kind: EPrEventKind.MergeQueue, queue: EMergeQueueMove.Left })),
    ).toBe('PR #794: left the merge queue')
    expect(prEventLine(verdict({ kind: EPrEventKind.MergeQueue }))).toBe(
      'PR #794: merge queue membership changed',
    )
  })
})
