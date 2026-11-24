import {
  EPullRequestState,
  EPrEventKind,
  ETargetPhase,
  type SubscriptionTargetState,
  UNKNOWN_TARGET_STATE,
} from '@dltech/atlas-core'

import type { RunTarget } from './run-target'
import { labelOf, type PullRequestTarget } from './target'

const GITHUB_HOST = 'github.com'

export const repoFullNameOf = (repo: string): string =>
  repo.startsWith(`${GITHUB_HOST}/`) ? repo.slice(GITHUB_HOST.length + 1) : repo

export type SubscriptionPullRequest = {
  state: string
  merged_at: string | null
  draft?: boolean
  html_url: string
}

export type SubscriptionWorkflowRun = {
  id: number
  status: string
  conclusion: string | null
  name: string
  html_url: string
  head_branch: string | null
}

const pullRequestTerminalState = (args: {
  label: string
  target: PullRequestTarget
  pull: SubscriptionPullRequest
  state: EPullRequestState
  wording: string
}): SubscriptionTargetState => ({
  phase: ETargetPhase.Terminal,
  summary: `Pull request ${args.label} is already ${args.wording}.`,
  notice: {
    type: 'pr-event',
    repo: args.target.repo,
    prNumber: args.target.number,
    kind: EPrEventKind.State,
    url: args.pull.html_url,
    state: args.state,
  },
})

export const pullRequestStateOf = (args: {
  target: PullRequestTarget
  pull: SubscriptionPullRequest
}): SubscriptionTargetState => {
  const label = labelOf(args.target)
  if (args.pull.state === 'open') {
    return {
      phase: ETargetPhase.Open,
      summary: `Pull request ${label} is ${args.pull.draft === true ? 'a draft' : 'open'}.`,
    }
  }
  if (args.pull.merged_at !== null) {
    return pullRequestTerminalState({
      label,
      target: args.target,
      pull: args.pull,
      state: EPullRequestState.Merged,
      wording: 'merged',
    })
  }
  return pullRequestTerminalState({
    label,
    target: args.target,
    pull: args.pull,
    state: EPullRequestState.Closed,
    wording: 'closed',
  })
}

export const runStateOf = (args: {
  target: RunTarget
  run: SubscriptionWorkflowRun
  failedJobs: readonly string[]
}): SubscriptionTargetState => {
  if (args.target.kind !== 'run') return UNKNOWN_TARGET_STATE
  const { run } = args
  const name = run.name === '' ? `#${run.id}` : run.name
  if (run.status !== 'completed') {
    return {
      phase: ETargetPhase.Open,
      summary: `Workflow run ${name} #${run.id} is ${run.status}.`,
    }
  }
  const conclusion = run.conclusion ?? ''
  return {
    phase: ETargetPhase.Terminal,
    summary: `Workflow run ${name} #${run.id} already finished with conclusion ${conclusion}.`,
    notice: {
      type: 'run-event',
      repo: repoFullNameOf(args.target.repo),
      workflowRunId: run.id,
      workflow: name,
      branch: run.head_branch ?? '',
      url: run.html_url,
      status: run.status,
      conclusion,
      failedJobs: [...args.failedJobs],
    },
  }
}
