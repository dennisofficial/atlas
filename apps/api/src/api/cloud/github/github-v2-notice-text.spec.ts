import { describe, expect, it } from 'bun:test'
import { EPrEventKind } from './github-realtime.types'
import { v2NoticeText } from './github-v2-notice-text'

const URL = 'https://github.com/compai/app/pull/42'
const TALLY = { checksPassed: 2, checksFailed: 1, checksRunning: 0 }

describe('v2NoticeText', () => {
  it('names the PR and the failed checks', () => {
    expect(
      v2NoticeText({
        kind: EPrEventKind.Verdict,
        prNumber: 42,
        tally: TALLY,
        payload: { url: URL, verdict: 'failed', settled: true, failedChecks: [{ name: 'build' }] },
      }),
    ).toBe(`GitHub: PR #42 (${URL}): checks failed (2 passed, 1 failed, 0 running). Failed: build.`)
  })

  it('marks an unsettled failure', () => {
    expect(
      v2NoticeText({
        kind: EPrEventKind.Verdict,
        prNumber: 42,
        tally: null,
        payload: { url: URL, verdict: 'failed', settled: false },
      }),
    ).toBe(`GitHub: PR #42 (${URL}): a check failed, others still running.`)
  })

  it('reports merged and closed transitions and mergeability', () => {
    const base = { prNumber: 42, tally: null }
    expect(
      v2NoticeText({ ...base, kind: EPrEventKind.State, payload: { url: URL, state: 'merged' } }),
    ).toBe(`GitHub: PR #42 (${URL}) was merged.`)
    expect(
      v2NoticeText({
        ...base,
        kind: EPrEventKind.Mergeability,
        payload: { url: URL, mergeable: false },
      }),
    ).toBe(`GitHub: PR #42 (${URL}) has merge conflicts.`)
  })

  it('names a reviewer and a comment author', () => {
    const base = { prNumber: 42, tally: null }
    expect(
      v2NoticeText({
        ...base,
        kind: EPrEventKind.Review,
        payload: { url: URL, authorLogin: 'dennis', reviewState: 'approved' },
      }),
    ).toBe(`GitHub: PR #42 (${URL}): new review from @dennis: approved.`)
    expect(
      v2NoticeText({
        ...base,
        kind: EPrEventKind.Comment,
        payload: { url: URL, authorLogin: 'dennis' },
      }),
    ).toBe(`GitHub: PR #42 (${URL}): new comment from @dennis.`)
  })
})
