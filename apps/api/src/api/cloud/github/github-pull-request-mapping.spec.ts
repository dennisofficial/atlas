import { describe, expect, it } from 'bun:test'
import {
  pullRequestCacheFieldsOf,
  pullRequestStateOf,
  type RestCheckRun,
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
  head: {
    ref: 'dennis/add-the-thing',
    sha: 'abc123',
    repo: { full_name: 'compai/app' },
  },
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

const run = (over: Partial<RestCheckRun>): RestCheckRun => ({
  id: 1,
  name: 'build',
  status: 'completed',
  conclusion: 'success',
  started_at: '2026-11-02T04:25:00Z',
  completed_at: null,
  ...over,
})

describe('pullRequestCacheFieldsOf', () => {
  it('tallies check runs by outcome and leaves skipped and neutral out', () => {
    const fields = pullRequestCacheFieldsOf({
      pull: pull({ mergeable: true, mergeable_state: 'clean' }),
      checkRuns: [
        run({ name: 'a', status: 'in_progress', conclusion: null }),
        run({ name: 'b' }),
        run({ name: 'c', conclusion: 'neutral' }),
        run({ name: 'd', conclusion: 'skipped' }),
        run({ name: 'e', conclusion: 'failure' }),
        run({ name: 'f', conclusion: 'cancelled' }),
      ],
      statuses: [],
    })

    expect(fields).toMatchObject({
      checksRunning: 1,
      checksPassed: 1,
      checksFailed: 2,
      mergeable: true,
      headBranch: 'dennis/add-the-thing',
    })
  })

  it('counts a re-run once, by its newest attempt', () => {
    const fields = pullRequestCacheFieldsOf({
      pull: pull({}),
      checkRuns: [
        run({ conclusion: 'cancelled', started_at: '2026-11-02T04:25:00Z' }),
        run({ conclusion: 'success', started_at: '2026-11-02T04:26:00Z' }),
      ],
      statuses: [],
    })

    expect(fields).toMatchObject({
      checksRunning: 0,
      checksPassed: 1,
      checksFailed: 0,
    })
  })

  it('reads a head whose checks were all skipped as nothing running, passed or failed', () => {
    const fields = pullRequestCacheFieldsOf({
      pull: pull({}),
      checkRuns: [run({ name: 'release', conclusion: 'skipped' })],
      statuses: [],
    })

    expect(fields).toMatchObject({
      checksRunning: 0,
      checksPassed: 0,
      checksFailed: 0,
    })
  })

  it('keeps only the latest commit status per context', () => {
    const fields = pullRequestCacheFieldsOf({
      pull: pull({}),
      checkRuns: [],
      statuses: [
        {
          context: 'ci/build',
          state: 'success',
          created_at: '2026-11-02T04:25:00Z',
          updated_at: '2026-11-02T04:25:00Z',
        },
        {
          context: 'ci/build',
          state: 'pending',
          created_at: '2026-11-02T04:20:00Z',
          updated_at: '2026-11-02T04:20:00Z',
        },
        {
          context: 'deploy',
          state: 'failure',
          created_at: '2026-11-02T04:25:00Z',
          updated_at: '2026-11-02T04:25:00Z',
        },
      ],
    })

    expect(fields).toMatchObject({
      checksRunning: 0,
      checksPassed: 1,
      checksFailed: 1,
    })
  })
})
