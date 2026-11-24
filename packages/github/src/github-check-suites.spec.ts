import { describe, expect, it } from 'bun:test'

import { pendingCheckSuiteCountOf } from './github-check-suites'

const suite = (
  slug: string,
  status: string,
  args: { runs?: number; conclusion?: string } = {},
) => ({
  status,
  conclusion: args.conclusion ?? null,
  latest_check_runs_count: args.runs ?? 0,
  app: { slug },
})

describe('pendingCheckSuiteCountOf', () => {
  it('counts a GitHub Actions suite that has not created its check runs yet', () => {
    expect(pendingCheckSuiteCountOf([suite('github-actions', 'queued')])).toBe(1)
  })

  it('counts every pending status of an app that has check runs', () => {
    expect(
      pendingCheckSuiteCountOf([
        suite('circleci', 'in_progress', { runs: 4 }),
        suite('circleci', 'waiting', { runs: 2 }),
        suite('circleci', 'requested', { runs: 1 }),
        suite('circleci', 'pending', { runs: 1 }),
      ]),
    ).toBe(4)
  })

  it('ignores an empty queued suite of an app that runs nothing for the commit', () => {
    expect(
      pendingCheckSuiteCountOf([
        suite('vercel', 'queued'),
        suite('sentry', 'queued'),
        suite('renovate', 'queued'),
      ]),
    ).toBe(0)
  })

  it('ignores a completed suite and a suite with a conclusion', () => {
    expect(
      pendingCheckSuiteCountOf([
        suite('github-actions', 'completed', { runs: 5, conclusion: 'success' }),
        suite('github-actions', 'completed', { runs: 5, conclusion: 'failure' }),
        suite('circleci', 'in_progress', { runs: 2, conclusion: 'cancelled' }),
      ]),
    ).toBe(0)
  })

  it('ignores a suite without a status or an app', () => {
    expect(
      pendingCheckSuiteCountOf([
        { latest_check_runs_count: 0 },
        { status: 'queued', latest_check_runs_count: 0 },
      ]),
    ).toBe(0)
  })
})
