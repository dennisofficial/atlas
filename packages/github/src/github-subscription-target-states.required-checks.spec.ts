import { afterEach, describe, expect, it, spyOn } from 'bun:test'

import { ETargetPhase } from '@dltech/atlas-core'
import { GITHUB_PROVIDER } from '@dltech/atlas-plugin-github/core'

import { GithubSubscriptionTargetStates } from './github-subscription-target-states'

const HEAD = 'a1b2c3d4e5f6'
const API = 'https://api.github.com/repos/dltech/atlas'
const PULL_URL = `${API}/pulls/7`
const CHECK_RUNS_URL = `${API}/commits/${HEAD}/check-runs?per_page=100`
const STATUS_URL = `${API}/commits/${HEAD}/status`
const SUITES_URL = `${API}/commits/${HEAD}/check-suites?per_page=100`
const RULES_URL = `${API}/rules/branches/main`
const REVIEWS_URL = `${API}/pulls/7/reviews?per_page=100`

const OPEN_PULL = {
  state: 'open',
  merged_at: null,
  draft: false,
  html_url: 'https://github.com/dltech/atlas/pull/7',
  mergeable: true,
  head: { sha: HEAD },
  base: { ref: 'main' },
}

const REQUIRES_CI = [
  { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'ci' }] } },
]

const ciRun = {
  id: 1,
  name: 'ci',
  status: 'completed',
  conclusion: 'success',
  started_at: '2026-11-25T10:00:00Z',
  completed_at: '2026-11-25T10:05:00Z',
}

const skippedVercel = {
  id: 2,
  context: 'Vercel – atlas-storybook',
  state: 'success',
  created_at: '2026-11-25T10:00:00Z',
}

const snapshotWith = async (checkRuns: readonly unknown[]) => {
  const responses: Record<string, unknown> = {
    [PULL_URL]: OPEN_PULL,
    [CHECK_RUNS_URL]: { check_runs: checkRuns },
    [STATUS_URL]: { statuses: [skippedVercel] },
    [SUITES_URL]: { check_suites: [] },
    [RULES_URL]: REQUIRES_CI,
    [REVIEWS_URL]: [],
  }
  const mock = spyOn(globalThis, 'fetch').mockImplementation((async (input: URL | string) => {
    const body = responses[String(input)]
    if (body === undefined) return new Response('not found', { status: 404 })
    return Response.json(body)
  }) as unknown as typeof fetch)
  restore = () => mock.mockRestore()
  const state = await new GithubSubscriptionTargetStates({ tokenFor: async () => 'ghu_1' }).read({
    userId: 'u1',
    provider: GITHUB_PROVIDER,
    target: { repo: 'github.com/dltech/atlas', number: 7 },
  })
  if (state.phase !== ETargetPhase.Open) throw new Error('expected an open pull request')
  return state.snapshot
}

let restore: () => void = () => {}

describe('the subscribe snapshot of a pull request whose base branch requires a check', () => {
  afterEach(() => restore())

  it('says CI is still running while the required check has not reported', async () => {
    const snapshot = await snapshotWith([])

    expect(snapshot?.facts).toContain(
      'CI is still running (1 passed, 0 failed, 0 running), waiting for required ci to report',
    )
    expect(snapshot?.next).toBe('A CI notice follows when it settles.')
  })

  it('says CI finished once the required check has reported', async () => {
    const snapshot = await snapshotWith([ciRun])

    expect(snapshot?.facts).toContain(
      'CI finished, all checks passed (2 passed, 0 failed, 0 running)',
    )
    expect(snapshot?.next).toStartWith('No CI notice comes for this head.')
  })
})
