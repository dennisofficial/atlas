import { describe, expect, it } from 'bun:test'

import {
  EPullRequestState,
  EPrEventKind,
  ETargetPhase,
  inboxEventPayloadOf,
  type SubscriptionTargetState,
} from '@dltech/atlas-core'

import { pullRequestStateOf, repoFullNameOf, runStateOf } from '../target-state'

const PR = { repo: 'github.com/dltech/atlas', number: 7 }
const RUN = { kind: 'run' as const, repo: 'github.com/dltech/atlas', runId: 42 }

const pull = (overrides: Partial<Parameters<typeof pullRequestStateOf>[0]['pull']> = {}) => ({
  state: 'open',
  merged_at: null,
  draft: false,
  html_url: 'https://github.com/dltech/atlas/pull/7',
  ...overrides,
})

const run = (
  overrides: Partial<Parameters<typeof runStateOf>[0]['run']> = {},
): Parameters<typeof runStateOf>[0]['run'] => ({
  id: 42,
  status: 'completed',
  conclusion: 'failure',
  name: 'CI',
  html_url: 'https://github.com/dltech/atlas/actions/runs/42',
  head_branch: 'dennis/work',
  ...overrides,
})

const noticeOf = (state: SubscriptionTargetState): unknown => {
  if (state.phase !== ETargetPhase.Terminal) throw new Error('expected a terminal state')
  inboxEventPayloadOf({ event: state.notice })
  return state.notice
}

describe('repoFullNameOf', () => {
  it('drops the host from a github.com repository', () => {
    expect(repoFullNameOf('github.com/dltech/atlas')).toBe('dltech/atlas')
    expect(repoFullNameOf('dltech/atlas')).toBe('dltech/atlas')
  })
})

describe('pullRequestStateOf', () => {
  it('reports an open pull request', () => {
    expect(pullRequestStateOf({ target: PR, pull: pull() })).toEqual({
      phase: ETargetPhase.Open,
      summary: 'Pull request dltech/atlas#7 is open.',
    })
  })

  it('reports a draft pull request', () => {
    expect(pullRequestStateOf({ target: PR, pull: pull({ draft: true }) })).toEqual({
      phase: ETargetPhase.Open,
      summary: 'Pull request dltech/atlas#7 is a draft.',
    })
  })

  it('reports a merged pull request with a state notice', () => {
    const state = pullRequestStateOf({
      target: PR,
      pull: pull({ state: 'closed', merged_at: '2026-11-24T00:00:00Z' }),
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
    expect(noticeOf(state)).toEqual({
      type: 'pr-event',
      repo: 'github.com/dltech/atlas',
      prNumber: 7,
      kind: 'state',
      url: 'https://github.com/dltech/atlas/pull/7',
      state: 'merged',
    })
  })

  it('reports a closed pull request that never merged', () => {
    const state = pullRequestStateOf({ target: PR, pull: pull({ state: 'closed' }) })
    expect(state).toEqual({
      phase: ETargetPhase.Terminal,
      summary: 'Pull request dltech/atlas#7 is already closed.',
      notice: {
        type: 'pr-event',
        repo: 'github.com/dltech/atlas',
        prNumber: 7,
        kind: EPrEventKind.State,
        url: 'https://github.com/dltech/atlas/pull/7',
        state: EPullRequestState.Closed,
      },
    })
    noticeOf(state)
  })
})

describe('runStateOf', () => {
  it('reports a running workflow run', () => {
    expect(
      runStateOf({ target: RUN, run: run({ status: 'in_progress' }), failedJobs: [] }),
    ).toEqual({
      phase: ETargetPhase.Open,
      summary: 'Workflow run CI #42 is in_progress.',
    })
  })

  it('reports a completed run with its failed jobs', () => {
    const state = runStateOf({
      target: RUN,
      run: run(),
      failedJobs: ['test (20)', 'typecheck'],
    })
    expect(state).toEqual({
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
        failedJobs: ['test (20)', 'typecheck'],
      },
    })
    noticeOf(state)
  })

  it('falls back to the run id and an empty branch when GitHub leaves them blank', () => {
    const state = runStateOf({
      target: RUN,
      run: run({ name: '', head_branch: null, conclusion: 'success' }),
      failedJobs: [],
    })
    expect(state).toEqual({
      phase: ETargetPhase.Terminal,
      summary: 'Workflow run #42 #42 already finished with conclusion success.',
      notice: {
        type: 'run-event',
        repo: 'dltech/atlas',
        workflowRunId: 42,
        workflow: '#42',
        branch: '',
        url: 'https://github.com/dltech/atlas/actions/runs/42',
        status: 'completed',
        conclusion: 'success',
        failedJobs: [],
      },
    })
    noticeOf(state)
  })

  it('leaves a workflow selector unknown', () => {
    expect(
      runStateOf({
        target: {
          kind: 'selector',
          repo: 'github.com/dltech/atlas',
          workflow: 'ci.yml',
          branch: 'main',
        },
        run: run(),
        failedJobs: [],
      }),
    ).toEqual({ phase: ETargetPhase.Unknown })
  })
})
