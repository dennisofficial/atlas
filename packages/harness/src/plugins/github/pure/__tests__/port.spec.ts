import { describe, expect, it } from 'bun:test'

import { EChecksState, EPullRequestState, NO_CHECKS, type PullRequest } from '../pull-request'
import { EPullRequestLookup, samePullRequestReading, type PullRequestReading } from '../port'

const found = (extra: Partial<PullRequest> = {}): PullRequestReading => ({
  lookup: EPullRequestLookup.Found,
  pullRequest: {
    number: 7,
    title: 'a change',
    url: 'https://github.com/o/r/pull/7',
    headSha: 'abc123',
    state: EPullRequestState.Open,
    checks: EChecksState.Passing,
    tally: NO_CHECKS,
    mergeable: null,
    comments: [],
    reviews: [],
    ...extra,
  },
})

describe('samePullRequestReading pollBacked', () => {
  it('treats a flip to polled as a change so the pill re-renders', () => {
    expect(samePullRequestReading(found(), found({ pollBacked: true }))).toBe(false)
    expect(samePullRequestReading(found({ pollBacked: true }), found())).toBe(false)
  })

  it('treats absent and false as the same realtime reading', () => {
    expect(samePullRequestReading(found(), found({ pollBacked: false }))).toBe(true)
  })

  it('treats two polled readings as the same', () => {
    expect(samePullRequestReading(found({ pollBacked: true }), found({ pollBacked: true }))).toBe(
      true,
    )
  })
})
