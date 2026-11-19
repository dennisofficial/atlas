import type { ContextMeter } from '../context-meter'
import type { V2Event } from '../event'
import type { SpendRow } from '../../models/spend-tally'
import { checkoutsOf, initialCheckoutsState, stepCheckouts } from './checkouts'
import type { CheckoutsState, CheckoutsView } from './checkouts'
import { deriveStatus } from './derive-status'
import {
  failureMessageOf,
  initialFailureMessage,
  stepFailureMessage,
  type FailureMessageState,
} from './failure-message'
import { EMPTY_PENDING, stepPending, type PendingInputsState } from '../pending-inputs'
import { initialMeterState, meterOf, rebuildMeter, stepMeter, type MeterState } from './meter-state'
import { initialSpendState, stepSpend, type SpendState } from './spend'
import { initialStatusFacts, stepStatusFacts, type StatusFacts } from './status-facts'
import type { PluginViewFold } from './plugin-view'
import type { SessionStatus } from './status-types'

export const SESSION_VIEW_VERSION = 9

export type SessionViewState = {
  version: number
  at: number
  facts: StatusFacts
  meter: MeterState
  checkouts: CheckoutsState
  spend: SpendState
  pending: PendingInputsState
  failure: FailureMessageState
  pluginViews: Readonly<Record<string, unknown>>
}

export type SessionViewValue = {
  status: SessionStatus
  context: ContextMeter | null
  spend: readonly SpendRow[]
  checkouts: CheckoutsView
  pluginViews: Readonly<Record<string, unknown>>
}

export const initialSessionViewState: SessionViewState = {
  version: SESSION_VIEW_VERSION,
  at: 0,
  facts: initialStatusFacts,
  meter: initialMeterState,
  checkouts: initialCheckoutsState,
  spend: initialSpendState,
  pending: EMPTY_PENDING,
  failure: initialFailureMessage,
  pluginViews: {},
}

export const stepSessionView = (state: SessionViewState, event: V2Event): SessionViewState => ({
  version: state.version,
  at: event.seq,
  facts: stepStatusFacts(state.facts, event),
  meter: stepMeter(state.meter, event),
  checkouts:
    event.type === 'branches-observed' ? stepCheckouts(state.checkouts, event) : state.checkouts,
  spend: stepSpend(state.spend, event),
  pending: stepPending(state.pending, event),
  failure: stepFailureMessage(state.failure, event),
  pluginViews: state.pluginViews,
})

export const foldPluginViews = (args: {
  bag: Readonly<Record<string, unknown>>
  views: readonly PluginViewFold[]
  event: V2Event
}): Readonly<Record<string, unknown>> => {
  let bag = args.bag
  for (const view of args.views) {
    const current = Object.hasOwn(bag, view.name) ? bag[view.name] : view.initial
    bag = { ...bag, [view.name]: view.fold(current, args.event) }
  }
  return bag
}

export const refoldRewindable = (args: {
  bag: Readonly<Record<string, unknown>>
  views: readonly PluginViewFold[]
  surviving: readonly V2Event[]
}): Readonly<Record<string, unknown>> => {
  let bag = args.bag
  for (const view of args.views) {
    if (view.rewindable !== true) continue
    bag = { ...bag, [view.name]: args.surviving.reduce(view.fold, view.initial) }
  }
  return bag
}

export const stepSessionViewWith = (args: {
  state: SessionViewState
  views: readonly PluginViewFold[]
  event: V2Event
}): SessionViewState => {
  const state = stepSessionView(args.state, args.event)
  if (args.views.length === 0) return state
  return {
    ...state,
    pluginViews: foldPluginViews({ bag: state.pluginViews, views: args.views, event: args.event }),
  }
}

export const needsRebuild = (event: V2Event): boolean =>
  event.type === 'history-rewound' || event.type === 'history-summarised'

export const rebuildEditSensitive = (args: {
  state: SessionViewState
  visibleTail: readonly V2Event[]
}): SessionViewState => ({
  ...args.state,
  facts: args.visibleTail.reduce(stepStatusFacts, initialStatusFacts),
  meter: rebuildMeter({ state: args.state.meter, visibleTail: args.visibleTail }),
  failure: failureMessageOf(args.visibleTail),
})

export const sessionViewOf = (args: {
  state: SessionViewState
  live: boolean
  queuedSince: string | null
  messageAfterFailure?: boolean | undefined
  now: string
}): SessionViewValue => ({
  status: deriveStatus({
    facts: args.state.facts,
    live: args.live,
    queuedSince: args.queuedSince,
    pending: args.state.pending,
    messageAfterFailure: args.messageAfterFailure,
    now: args.now,
  }),
  context: meterOf(args.state.meter),
  spend: args.state.spend.rows,
  checkouts: checkoutsOf(args.state.checkouts),
  pluginViews: args.state.pluginViews,
})
