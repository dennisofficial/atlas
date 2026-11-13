import type { SpendTally } from '@dltech/atlas-core'
import {
  crewOfView,
  crewRosterOf,
  type CrewRoster,
  type CrewRow,
} from '@dltech/atlas-plugin-crew/client'
import {
  subscribedPullRequestsOf,
  type SubscribedPullRequest,
} from '@dltech/atlas-plugin-github/client'
import { previewsOfView, type PreviewItem } from '@dltech/atlas-plugin-services/client'
import { shellRosterOf, type ShellRoster } from '@dltech/atlas-plugin-shells/client'
import type { SessionSummary, SessionViewOutput } from '@dltech/atlas-protocol'

import type { PullRequestEntry } from '@/features/threads/data/pull-request-entries'

type LinkedPullRequest = SessionViewOutput['pullRequests'][number]
type RowPullRequest = NonNullable<SessionSummary['pullRequest']>

export type SessionContextModel = {
  used: number | null
  limit: number
}

export type SessionViewModel = {
  branch: string | undefined
  entries: PullRequestEntry[]
  subscriptions: readonly SubscribedPullRequest[]
  shells: ShellRoster
  crew: CrewRoster
  crewRows: readonly CrewRow[]
  previews: readonly PreviewItem[]
  context: SessionContextModel | null
  spend: SpendTally | null
}

export const pullRequestEntryOf = (args: {
  pullRequest: LinkedPullRequest
  primaryBranch: string | undefined
}): PullRequestEntry => {
  const { pullRequest, primaryBranch } = args
  const { state } = pullRequest
  return {
    repo: pullRequest.repo,
    number: pullRequest.number,
    url: pullRequest.url,
    branch: pullRequest.branch,
    state: state?.state,
    title: state?.title,
    checksRunning: state?.checks.running,
    checksPassed: state?.checks.passed,
    checksFailed: state?.checks.failed,
    checksState: undefined,
    mergeable: state === null ? undefined : state.mergeable,
    current: primaryBranch !== undefined && pullRequest.branch === primaryBranch,
    via: undefined,
  }
}

export const rowPullRequestEntryOf = (pullRequest: RowPullRequest): PullRequestEntry => ({
  repo: pullRequest.repo,
  number: pullRequest.number,
  url: pullRequest.url,
  branch: '',
  state: pullRequest.state ?? undefined,
  checksRunning: pullRequest.checks?.running,
  checksPassed: pullRequest.checks?.passed,
  checksFailed: pullRequest.checks?.failed,
  checksState: undefined,
  mergeable: undefined,
  current: false,
  via: undefined,
})

export const contextOfView = (view: SessionViewOutput): SessionContextModel | null => {
  const { context } = view
  if (context === null || context.window === null || context.window <= 0) return null
  return { used: context.used, limit: context.window }
}

export const shellTailTextOf = (
  shells: Readonly<Record<string, { text: string }>>,
): Record<string, string> =>
  Object.fromEntries(Object.entries(shells).map(([shellId, tail]) => [shellId, tail.text]))

export const sessionViewModelOf = (view: SessionViewOutput | undefined): SessionViewModel => {
  if (view === undefined)
    return {
      branch: undefined,
      entries: [],
      subscriptions: [],
      shells: { running: 0, awaitingInput: false, labels: [], rows: [] },
      crew: { running: 0, total: 0 },
      crewRows: [],
      previews: [],
      context: null,
      spend: null,
    }
  const primaryBranch = view.checkouts.primary?.branch
  return {
    branch: primaryBranch,
    entries: view.pullRequests.map((pullRequest) =>
      pullRequestEntryOf({ pullRequest, primaryBranch }),
    ),
    subscriptions: subscribedPullRequestsOf(view.pluginViews),
    shells: shellRosterOf(view.pluginViews),
    crew: crewRosterOf(view.pluginViews),
    crewRows: crewOfView(view.pluginViews),
    previews: previewsOfView(view.pluginViews),
    context: contextOfView(view),
    spend: view.spend.tally,
  }
}
