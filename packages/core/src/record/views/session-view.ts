import type { ContextMeter } from '../context-meter'
import type { V2Event } from '../event'
import type { SpendRow } from '../../models/spend-tally'
import { checkoutsOf, initialCheckoutsState, stepCheckouts } from './checkouts'
import type { CheckoutsState, CheckoutsView } from './checkouts'
import { deriveStatus } from './derive-status'
import { initialMeterState, meterOf, rebuildMeter, stepMeter, type MeterState } from './meter-state'
import {
  initialPullRequestLinks,
  stepPullRequestLinks,
  type PullRequestLink,
  type PullRequestLinksState,
} from './pull-request-links'
import { initialSpendState, stepSpend, type SpendState } from './spend'
import { initialStatusFacts, stepStatusFacts, type StatusFacts } from './status-facts'
import type { SessionStatus } from './status-types'

export const SESSION_VIEW_VERSION = 4

export type SessionViewState = {
  version: number
  at: number
  facts: StatusFacts
  meter: MeterState
  checkouts: CheckoutsState
  pullRequests: PullRequestLinksState
  spend: SpendState
  pluginViews: Readonly<Record<string, unknown>>
}

export type SessionViewValue = {
  status: SessionStatus
  context: ContextMeter | null
  spend: readonly SpendRow[]
  checkouts: CheckoutsView
  pullRequests: readonly PullRequestLink[]
  pluginViews: Readonly<Record<string, unknown>>
}

export const initialSessionViewState: SessionViewState = {
  version: SESSION_VIEW_VERSION,
  at: 0,
  facts: initialStatusFacts,
  meter: initialMeterState,
  checkouts: initialCheckoutsState,
  pullRequests: initialPullRequestLinks,
  spend: initialSpendState,
  pluginViews: {},
}

export const stepSessionView = (state: SessionViewState, event: V2Event): SessionViewState => ({
  version: state.version,
  at: event.seq,
  facts: stepStatusFacts(state.facts, event),
  meter: stepMeter(state.meter, event),
  checkouts:
    event.type === 'branches-observed' ? stepCheckouts(state.checkouts, event) : state.checkouts,
  pullRequests: stepPullRequestLinks(state.pullRequests, event),
  spend: stepSpend(state.spend, event),
  pluginViews: state.pluginViews,
})

export const needsRebuild = (event: V2Event): boolean =>
  event.type === 'history-rewound' || event.type === 'history-summarised'

export const rebuildEditSensitive = (args: {
  state: SessionViewState
  visibleTail: readonly V2Event[]
}): SessionViewState => ({
  ...args.state,
  facts: args.visibleTail.reduce(stepStatusFacts, initialStatusFacts),
  meter: rebuildMeter({ state: args.state.meter, visibleTail: args.visibleTail }),
})

export const sessionViewOf = (args: {
  state: SessionViewState
  live: boolean
  unconsumedInbox: boolean
  messageAfterFailure?: boolean | undefined
  now: string
}): SessionViewValue => ({
  status: deriveStatus({
    facts: args.state.facts,
    live: args.live,
    unconsumedInbox: args.unconsumedInbox,
    messageAfterFailure: args.messageAfterFailure,
    now: args.now,
  }),
  context: meterOf(args.state.meter),
  spend: args.state.spend.rows,
  checkouts: checkoutsOf(args.state.checkouts),
  pullRequests: args.state.pullRequests.links,
  pluginViews: args.state.pluginViews,
})
