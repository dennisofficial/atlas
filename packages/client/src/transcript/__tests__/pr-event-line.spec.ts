import { describe, expect, it } from 'bun:test'

import { EPrEventKind, EPrVerdict, type EventOfType } from '@dltech/atlas-core'

import { prEventLine } from '../pr-event-line'

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

describe('a failed verdict line', () => {
  it('names the failed checks while CI runs', () => {
    expect(
      prEventLine(verdict({ settled: false, failedChecks: named('typecheck', 'vercel') })),
    ).toBe('PR #794: typecheck, vercel failed, CI still running')
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
