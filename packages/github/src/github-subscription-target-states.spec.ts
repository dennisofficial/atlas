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

  it('reports an open pull request', async () => {
    stub({
      [PULL_URL]: {
        body: {
          state: 'open',
          merged_at: null,
          draft: false,
          html_url: 'https://github.com/dltech/atlas/pull/7',
        },
      },
    })

    expect(
      await reader({ token: 'ghu_1' }).read({
        userId: 'u1',
        provider: GITHUB_PROVIDER,
        target: PR_TARGET,
      }),
    ).toEqual({ phase: ETargetPhase.Open, summary: 'Pull request dltech/atlas#7 is open.' })
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

  it('reports a run still in progress as open without reading jobs', async () => {
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
    })

    expect(
      await reader({ token: 'ghu_1' }).read({
        userId: 'u1',
        provider: GITHUB_RUN_PROVIDER,
        target: RUN_TARGET,
      }),
    ).toEqual({ phase: ETargetPhase.Open, summary: 'Workflow run CI #42 is in_progress.' })
    expect(urls).toEqual([RUN_URL])
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
