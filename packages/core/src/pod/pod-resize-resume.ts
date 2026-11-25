import { deriveStatus } from '../record/views/derive-status'
import type { SessionViewState } from '../record/views/session-view'
import { setupRunningOf } from '../record/views/status-facts'
import { podBusyFactsOf, podResizeBusyOf, type PodBusyFacts } from './pod-busy'

export type PodResizeWaitRow = {
  podSizeGeneration: number
  podWaitingSince: string | null
}

export type PodResizeResume = { generation: number; waitedSince: string }

export const podBusyFactsOfView = (args: {
  state: SessionViewState
  now: string
  shellsRunning: number
  servicesRunning: number
}): PodBusyFacts => {
  const status = deriveStatus({
    facts: args.state.facts,
    live: true,
    queuedSince: null,
    pending: args.state.pending,
    now: args.now,
  })
  return podBusyFactsOf({
    state: status.state,
    toolName: status.reason,
    setupRunning: setupRunningOf({ run: args.state.facts.setupRun, now: args.now }),
    shellsRunning: args.shellsRunning,
    servicesRunning: args.servicesRunning,
  })
}

export const podResizeWentIdle = (args: { before: PodBusyFacts; after: PodBusyFacts }): boolean =>
  podResizeBusyOf(args.before).busy && !podResizeBusyOf(args.after).busy

export const podResizeResumeOf = (args: {
  wentIdle: boolean
  session: PodResizeWaitRow | undefined
}): PodResizeResume | undefined => {
  if (!args.wentIdle || args.session === undefined) return undefined
  if (args.session.podWaitingSince === null) return undefined
  return { generation: args.session.podSizeGeneration, waitedSince: args.session.podWaitingSince }
}
