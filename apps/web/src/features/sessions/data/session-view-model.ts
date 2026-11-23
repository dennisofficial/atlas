import type { PlanTask, SpendTally } from '@dltech/atlas-core'
import {
  crewOfView,
  crewRosterOf,
  type CrewRoster,
  type CrewRow,
} from '@dltech/atlas-plugin-crew/client'
import {
  previewsOfView,
  servicesOfView,
  type PreviewItem,
} from '@dltech/atlas-plugin-services/client'
import type { ServiceRow } from '@dltech/atlas-plugin-services/core'
import { planOfView } from '@dltech/atlas-plugin-sessions/client'
import { shellRosterOf, shellsOfView, type ShellRoster } from '@dltech/atlas-plugin-shells/client'
import type { ShellRow } from '@dltech/atlas-plugin-shells/core'
import type { SessionSummary, SessionViewOutput } from '@dltech/atlas-protocol'

import type { PullRequestEntry } from '@/features/threads/data/pull-request-entries'

import { subscriptionRowsOf, type SubscriptionRow } from './subscription-rows'

type LinkedPullRequest = SessionViewOutput['pullRequests'][number]
type RowPullRequest = NonNullable<SessionSummary['pullRequest']>

export type SessionContextModel = {
  used: number | null
  limit: number
}

export type SessionViewModel = {
  branch: string | undefined
  entries: PullRequestEntry[]
  subscriptionRows: readonly SubscriptionRow[]
  shells: ShellRoster
  shellRows: readonly ShellRow[]
  serviceRows: readonly ServiceRow[]
  crew: CrewRoster
  crewRows: readonly CrewRow[]
  previews: readonly PreviewItem[]
  plan: readonly PlanTask[]
  context: SessionContextModel | null
  spend: SpendTally | null
  compute?: SessionViewOutput['compute'] | undefined
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
    checksExpected: state?.checks.expected,
    checksState: undefined,
    mergeable: state === null ? undefined : state.mergeable,
    mergeQueued: state?.mergeQueued,
    autoMerge: state?.autoMerge,
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
  checksExpected: pullRequest.checks?.expected,
  checksState: undefined,
  mergeable: pullRequest.mergeable,
  mergeQueued: pullRequest.mergeQueued,
  autoMerge: pullRequest.autoMerge,
  current: false,
  via: undefined,
})

export const contextOfView = (view: SessionViewOutput): SessionContextModel | null => {
  const { context } = view
  if (context === null || context.window === null || context.window <= 0) return null
  return { used: context.used, limit: context.window }
}

const RUNNING_FIRST = (status: string): number => (status === 'running' ? 0 : 1)

const newestFirst = (left: { changedAt: string }, right: { changedAt: string }): number =>
  right.changedAt.localeCompare(left.changedAt)

export const orderedShellRows = (rows: readonly ShellRow[]): readonly ShellRow[] =>
  [...rows].sort(
    (left, right) =>
      RUNNING_FIRST(left.status) - RUNNING_FIRST(right.status) || newestFirst(left, right),
  )

export const orderedServiceRows = (rows: readonly ServiceRow[]): readonly ServiceRow[] =>
  [...rows].sort(
    (left, right) =>
      RUNNING_FIRST(left.status) - RUNNING_FIRST(right.status) || newestFirst(left, right),
  )

export const shellTailTextOf = (
  shells: Readonly<Record<string, { text: string }>>,
): Record<string, string> =>
  Object.fromEntries(Object.entries(shells).map(([shellId, tail]) => [shellId, tail.text]))

export const sessionViewModelOf = (view: SessionViewOutput | undefined): SessionViewModel => {
  if (view === undefined)
    return {
      branch: undefined,
      entries: [],
      subscriptionRows: [],
      shells: { running: 0, awaitingInput: false, labels: [], rows: [] },
      shellRows: [],
      serviceRows: [],
      crew: { running: 0, total: 0 },
      crewRows: [],
      previews: [],
      plan: [],
      context: null,
      spend: null,
      compute: { costUsd: null, running: false, tick: null },
    }
  const primaryBranch = view.checkouts.primary?.branch
  const entries = view.pullRequests.map((pullRequest) =>
    pullRequestEntryOf({ pullRequest, primaryBranch }),
  )
  return {
    branch: primaryBranch,
    entries,
    subscriptionRows: subscriptionRowsOf({
      subscriptions: view.subscriptions,
      pullRequests: entries,
    }),
    shells: shellRosterOf(view.pluginViews),
    shellRows: orderedShellRows(shellsOfView(view.pluginViews)),
    serviceRows: orderedServiceRows(servicesOfView(view.pluginViews)),
    crew: crewRosterOf(view.pluginViews),
    crewRows: crewOfView(view.pluginViews),
    previews: previewsOfView(view.pluginViews),
    plan: planOfView(view.pluginViews),
    context: contextOfView(view),
    spend: view.spend.tally,
    compute: view.compute,
  }
}
