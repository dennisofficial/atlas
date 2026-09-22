import { describe, expect, it } from 'vitest'
import {
  pullRequestCacheFieldsOf,
  pullRequestStateOf,
  type RestPullRequest,
} from './github-pull-request-mapping'

const pull = (over: Partial<RestPullRequest>): RestPullRequest => ({
  number: 42,
  title: 'add the thing',
  html_url: 'https://github.com/compai/app/pull/42',
  state: 'open',
  draft: false,
  merged_at: null,
  mergeable: null,
  mergeable_state: 'unknown',
  head: { ref: 'dennis/add-the-thing', sha: 'abc123' },
  ...over,
})

describe('pullRequestStateOf', () => {
  it('maps the REST state pair onto the four states the client knows', () => {
    expect(pullRequestStateOf(pull({}))).toBe('open')
    expect(pullRequestStateOf(pull({ draft: true }))).toBe('draft')
    expect(pullRequestStateOf(pull({ state: 'closed', merged_at: '2026-09-21T00:00:00Z' }))).toBe(
      'merged',
    )
    expect(pullRequestStateOf(pull({ state: 'closed' }))).toBe('closed')
  })
})

describe('pullRequestCacheFieldsOf', () => {
  it('tallies check runs by conclusion bucket', () => {
    const fields = pullRequestCacheFieldsOf({
      pull: pull({ mergeable: true, mergeable_state: 'clean' }),
      checkRuns: [
        { status: 'in_progress', conclusion: null },
        { status: 'completed', conclusion: 'success' },
        { status: 'completed', conclusion: 'neutral' },
        { status: 'completed', conclusion: 'failure' },
        { status: 'completed', conclusion: 'cancelled' },
      ],
      statuses: [],
    })

    expect(fields).toMatchObject({
      checksRunning: 1,
      checksPassed: 2,
      checksFailed: 2,
      mergeable: true,
      mergeableState: 'clean',
      headBranch: 'dennis/add-the-thing',
    })
  })

  it('keeps only the latest commit status per context', () => {
    const fields = pullRequestCacheFieldsOf({
      pull: pull({}),
      checkRuns: [],
      statuses: [
        { context: 'ci/build', state: 'success' },
        { context: 'ci/build', state: 'pending' },
        { context: 'deploy', state: 'failure' },
      ],
    })

    expect(fields).toMatchObject({ checksRunning: 0, checksPassed: 1, checksFailed: 1 })
  })
})
