import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'

import { EPullRequestState, EPrEventKind, ETargetPhase } from '@dltech/atlas-core'
import { GITHUB_PROVIDER, GITHUB_RUN_PROVIDER } from '@dltech/atlas-plugin-github/core'

import { GithubSubscriptionTargetStates } from './github-subscription-target-states'

type Stub = { status?: number; body: unknown }

const reader = (args: { token?: string | undefined }) =>
  new GithubSubscriptionTargetStates({
    tokenFor: async () => args.token,
  })

const PR_TARGET = { repo: 'github.com/dltech/atlas', number: 7 }
const RUN_TARGET = { kind: 'run', repo: 'github.com/dltech/atlas', runId: 42 }

const PULL_URL = 'https://api.github.com/repos/dltech/atlas/pulls/7'
const RUN_URL = 'https://api.github.com/repos/dltech/atlas/actions/runs/42'
const JOBS_URL = 'https://api.github.com/repos/dltech/atlas/actions/runs/42/jobs?per_page=100'
const HEAD = 'a1b2c3d4e5f6'
const CHECK_RUNS_URL = `https://api.github.com/repos/dltech/atlas/commits/${HEAD}/check-runs?per_page=100`
const STATUS_URL = `https://api.github.com/repos/dltech/atlas/commits/${HEAD}/status`
const SUITES_URL = `https://api.github.com/repos/dltech/atlas/commits/${HEAD}/check-suites?per_page=100`
const REVIEWS_URL = 'https://api.github.com/repos/dltech/atlas/pulls/7/reviews?per_page=100'
const RULES_URL = 'https://api.github.com/repos/dltech/atlas/rules/branches/main'
const PROTECTION_URL =
  'https://api.github.com/repos/dltech/atlas/branches/main/protection/required_status_checks'

const checkRun = (id: number, name: string, conclusion: string) => ({
  id,
  name,
  status: 'completed',
  conclusion,
  started_at: '2026-11-24T10:00:00Z',
  completed_at: '2026-11-24T10:05:00Z',
})

const commitStatus = (id: number, context: string) => ({
  id,
  context,
  state: 'success',
  created_at: '2026-11-24T10:00:00Z',
})

const suite = (slug: string, args: { status: string; runs?: number }) => ({
  status: args.status,
  conclusion: null,
  latest_check_runs_count: args.runs ?? 0,
  app: { slug },
})

const OPEN_PULL = {
  state: 'open',
  merged_at: null,
  draft: false,
  html_url: 'https://github.com/dltech/atlas/pull/7',
  mergeable: true,
  head: { sha: HEAD },
  base: { ref: 'main' },
}

describe('GithubSubscriptionTargetStates', () => {
  const urls: string[] = []
  let restore: () => void

  const stub = (responses: Record<string, Stub>) => {
    const mock = spyOn(globalThis, 'fetch').mockImplementation((async (input: URL | string) => {
      const url = String(input)
      urls.push(url)
      const response = responses[url]
      if (response === undefined) return new Response('not found', { status: 404 })
      return Response.json(response.body, { status: response.status ?? 200 })
    }) as unknown as typeof fetch)
    restore = () => mock.mockRestore()
  }

  beforeEach(() => {
    urls.length = 0
  })
  afterEach(() => restore())

  it('reports a merged pull request as terminal with a state notice', async () => {
    stub({
      [PULL_URL]: {
        body: {
          state: 'closed',
          merged_at: '2026-11-24T00:00:00Z',
          html_url: 'https://github.com/dltech/atlas/pull/7',
        },
      },
    })

    const state = await reader({ token: 'ghu_1' }).read({
      userId: 'u1',
      provider: GITHUB_PROVIDER,
      target: PR_TARGET,
    })

    expect(state).toEqual({
      phase: ETargetPhase.Terminal,
      summary: 'Pull request dltech/atlas#7 is already merged.',
      notice: {
        type: 'pr-event',
        repo: 'github.com/dltech/atlas',
        prNumber: 7,
        kind: EPrEventKind.State,
        url: 'https://github.com/dltech/atlas/pull/7',
        state: EPullRequestState.Merged,
      },
    })
    expect(urls).toEqual([PULL_URL])
  })

  it('reports an open pull request with a snapshot of its head', async () => {
    stub({
      [PULL_URL]: {
        body: {
          state: 'open',
          merged_at: null,
          draft: false,
          html_url: 'https://github.com/dltech/atlas/pull/7',
          mergeable: true,
          head: { sha: HEAD },
          base: { ref: 'main' },
        },
      },
      [CHECK_RUNS_URL]: {
        body: {
          check_runs: [
            checkRun(1, 'test (20)', 'success'),
            checkRun(2, 'typecheck', 'success'),
            checkRun(3, 'lint', 'success'),
          ],
        },
      },
      [STATUS_URL]: { body: { statuses: [] } },
      [SUITES_URL]: {
        body: {
          check_suites: [
            suite('vercel', { status: 'queued' }),
            suite('github-actions', { status: 'completed', runs: 3 }),
          ],
        },
      },
      [REVIEWS_URL]: { body: [{ user: { login: 'tofik' }, state: 'APPROVED' }] },
    })

    expect(
      await reader({ token: 'ghu_1' }).read({
        userId: 'u1',
        provider: GITHUB_PROVIDER,
        target: PR_TARGET,
      }),
    ).toEqual({
      phase: ETargetPhase.Open,
      summary: 'Pull request dltech/atlas#7 is open.',
      snapshot: {
        facts: [
          'ready for review, head a1b2c3d',
          'CI finished, all checks passed (3 passed, 0 failed, 0 running)',
          'mergeable',
          'review approved',
        ],
        next: 'No CI notice comes for this head. The next notices are a new push, CI starting again, a comment or review, or a merge or close.',
      },
    })
    expect(urls).toEqual([
      PULL_URL,
      CHECK_RUNS_URL,
      STATUS_URL,
      SUITES_URL,
      RULES_URL,
      PROTECTION_URL,
      REVIEWS_URL,
    ])
  })

  it('counts a queued check suite as CI still running when no check run has started', async () => {
    stub({
      [PULL_URL]: { body: OPEN_PULL },
      [CHECK_RUNS_URL]: { body: { check_runs: [] } },
      [STATUS_URL]: {
        body: { statuses: [commitStatus(1, 'Vercel – atlas'), commitStatus(2, 'Vercel – web')] },
      },
      [SUITES_URL]: {
        body: {
          check_suites: [
            suite('vercel', { status: 'queued' }),
            suite('sentry', { status: 'queued' }),
            suite('renovate', { status: 'queued' }),
            suite('github-actions', { status: 'queued' }),
          ],
        },
      },
      [REVIEWS_URL]: { body: [] },
    })

    expect(
      await reader({ token: 'ghu_1' }).read({
        userId: 'u1',
        provider: GITHUB_PROVIDER,
        target: PR_TARGET,
      }),
    ).toEqual({
      phase: ETargetPhase.Open,
      summary: 'Pull request dltech/atlas#7 is open.',
      snapshot: {
        facts: [
          'ready for review, head a1b2c3d',
          'CI is still running (2 passed, 0 failed, 0 running)',
          'mergeable',
        ],
        next: 'A CI notice follows when it settles.',
      },
    })
  })

  it('ignores a queued suite of an app that runs nothing for the commit', async () => {
    stub({
      [PULL_URL]: { body: OPEN_PULL },
      [CHECK_RUNS_URL]: { body: { check_runs: [checkRun(1, 'test (20)', 'success')] } },
      [STATUS_URL]: {
        body: { statuses: [commitStatus(1, 'Vercel – atlas'), commitStatus(2, 'Vercel – web')] },
      },
      [SUITES_URL]: {
        body: {
          check_suites: [
            suite('vercel', { status: 'queued' }),
            suite('sentry', { status: 'queued' }),
            suite('github-actions', { status: 'completed', runs: 1 }),
          ],
        },
      },
      [REVIEWS_URL]: { body: [] },
    })

    const state = await reader({ token: 'ghu_1' }).read({
      userId: 'u1',
      provider: GITHUB_PROVIDER,
      target: PR_TARGET,
    })
    if (state.phase !== ETargetPhase.Open) throw new Error('expected an open pull request')

    expect(state.snapshot?.facts).toEqual([
      'ready for review, head a1b2c3d',
      'CI finished, all checks passed (3 passed, 0 failed, 0 running)',
      'mergeable',
    ])
    expect(state.snapshot?.next).toBe(
      'No CI notice comes for this head. The next notices are a new push, CI starting again, a comment or review, or a merge or close.',
    )
  })

  it('does not claim CI finished when the check suites cannot be read', async () => {
    stub({
      [PULL_URL]: { body: OPEN_PULL },
      [CHECK_RUNS_URL]: { body: { check_runs: [checkRun(1, 'test (20)', 'success')] } },
      [STATUS_URL]: { body: { statuses: [commitStatus(1, 'Vercel – atlas')] } },
    })

    const state = await reader({ token: 'ghu_1' }).read({
      userId: 'u1',
      provider: GITHUB_PROVIDER,
      target: PR_TARGET,
    })
    if (state.phase !== ETargetPhase.Open) throw new Error('expected an open pull request')

    expect(state.snapshot?.facts).toEqual([
      'ready for review, head a1b2c3d',
      'CI finished, all checks passed (2 passed, 0 failed, 0 running)',
      'mergeable',
    ])
    expect(state.snapshot?.next).toBe(
      'CI state is not known now. The next notices are a new push, CI starting again, a comment or review, or a merge or close.',
    )
  })

  it('keeps the pull request open when its checks and reviews cannot be read', async () => {
    stub({
      [PULL_URL]: {
        body: {
          state: 'open',
          merged_at: null,
          draft: true,
          html_url: 'https://github.com/dltech/atlas/pull/7',
          mergeable: null,
          head: { sha: HEAD },
          base: { ref: 'main' },
        },
      },
      [CHECK_RUNS_URL]: { status: 500, body: { message: 'boom' } },
    })

    expect(
      await reader({ token: 'ghu_1' }).read({
        userId: 'u1',
        provider: GITHUB_PROVIDER,
        target: PR_TARGET,
      }),
    ).toEqual({
      phase: ETargetPhase.Open,
      summary: 'Pull request dltech/atlas#7 is a draft.',
      snapshot: {
        facts: ['draft, head a1b2c3d', 'mergeability not known yet'],
        next: 'CI state is not known now. The next notices are a new push, CI starting again, a comment or review, or a merge or close.',
      },
    })
  })

  it('reports a failed run as terminal with its failed jobs', async () => {
    stub({
      [RUN_URL]: {
        body: {
          id: 42,
          status: 'completed',
          conclusion: 'failure',
          name: 'CI',
          html_url: 'https://github.com/dltech/atlas/actions/runs/42',
          head_branch: 'dennis/work',
        },
      },
      [JOBS_URL]: {
        body: {
          jobs: [
            { name: 'test (20)', conclusion: 'failure' },
            { name: 'typecheck', conclusion: 'success' },
            { name: 'lint', conclusion: 'failure' },
          ],
        },
      },
    })

    expect(
      await reader({ token: 'ghu_1' }).read({
        userId: 'u1',
        provider: GITHUB_RUN_PROVIDER,
        target: RUN_TARGET,
      }),
    ).toEqual({
      phase: ETargetPhase.Terminal,
      summary: 'Workflow run CI #42 already finished with conclusion failure.',
      notice: {
        type: 'run-event',
        repo: 'dltech/atlas',
        workflowRunId: 42,
        workflow: 'CI',
        branch: 'dennis/work',
        url: 'https://github.com/dltech/atlas/actions/runs/42',
        status: 'completed',
        conclusion: 'failure',
        failedJobs: ['test (20)', 'lint'],
      },
    })
    expect(urls).toEqual([RUN_URL, JOBS_URL])
  })

  it('reports a run still in progress with the jobs that started', async () => {
    stub({
      [RUN_URL]: {
        body: {
          id: 42,
          status: 'in_progress',
          conclusion: null,
          name: 'CI',
          html_url: 'https://github.com/dltech/atlas/actions/runs/42',
          head_branch: 'dennis/work',
        },
      },
      [JOBS_URL]: {
        body: {
          jobs: [
            { name: 'typecheck', status: 'completed', conclusion: 'success' },
            { name: 'test (20)', status: 'in_progress', conclusion: null },
          ],
        },
      },
    })

    expect(
      await reader({ token: 'ghu_1' }).read({
        userId: 'u1',
        provider: GITHUB_RUN_PROVIDER,
        target: RUN_TARGET,
      }),
    ).toEqual({
      phase: ETargetPhase.Open,
      summary: 'Workflow run CI #42 is in_progress.',
      snapshot: {
        facts: ['1 of 2 jobs finished'],
        next: 'A notice arrives when the run finishes.',
      },
    })
    expect(urls).toEqual([RUN_URL, JOBS_URL])
  })

  it('leaves a workflow selector unknown without a read', async () => {
    stub({})

    expect(
      await reader({ token: 'ghu_1' }).read({
        userId: 'u1',
        provider: GITHUB_RUN_PROVIDER,
        target: {
          kind: 'selector',
          repo: 'github.com/dltech/atlas',
          workflow: 'ci.yml',
          branch: 'main',
        },
      }),
    ).toEqual({ phase: ETargetPhase.Unknown })
    expect(urls).toEqual([])
  })

  it('leaves the target unknown when the user has no token', async () => {
    stub({})

    expect(
      await reader({ token: undefined }).read({
        userId: 'u1',
        provider: GITHUB_PROVIDER,
        target: PR_TARGET,
      }),
    ).toEqual({ phase: ETargetPhase.Unknown })
    expect(urls).toEqual([])
  })

  it('leaves the target unknown when GitHub answers 404', async () => {
    stub({})

    expect(
      await reader({ token: 'ghu_1' }).read({
        userId: 'u1',
        provider: GITHUB_PROVIDER,
        target: PR_TARGET,
      }),
    ).toEqual({ phase: ETargetPhase.Unknown })
  })

  it('leaves an unknown provider or target unknown', async () => {
    stub({})

    const states = reader({ token: 'ghu_1' })
    expect(await states.read({ userId: 'u1', provider: 'gitlab', target: PR_TARGET })).toEqual({
      phase: ETargetPhase.Unknown,
    })
    expect(
      await states.read({ userId: 'u1', provider: GITHUB_PROVIDER, target: { repo: 'nope' } }),
    ).toEqual({ phase: ETargetPhase.Unknown })
    expect(urls).toEqual([])
  })
})
