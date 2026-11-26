import type { ControlPlane, ControlSessionRow } from '@dltech/atlas-control'
import {
  podBusyFactsOf,
  podBusyFactsOfView,
  podBusyOf,
  podResizeBusyOf,
  podStopBusyOf,
  type PodBusy,
  type PodBusyFacts,
  type PodRebootFacts,
  type SessionViewState,
} from '@dltech/atlas-core'
import { shellRosterOf } from '@dltech/atlas-plugin-shells/client'
import { servicesOfView } from '@dltech/atlas-plugin-services/client'

const runningServicesOf = (views: Readonly<Record<string, unknown>>): number =>
  servicesOfView(views).filter((row) => row.status === 'running').length

export const podBusyFactsOfState = (args: { state: SessionViewState; now: string }): PodBusyFacts =>
  podBusyFactsOfView({
    state: args.state,
    now: args.now,
    shellsRunning: shellRosterOf(args.state.pluginViews).running,
    servicesRunning: runningServicesOf(args.state.pluginViews),
  })

type BusySession = Pick<ControlSessionRow, 'sessionId' | 'mainThreadId'>

const readPodBusyFacts = async (args: { plane: ControlPlane; session: BusySession }) => {
  const busy = await args.plane.readSessionBusy({
    sessionId: args.session.sessionId,
    threadId: args.session.mainThreadId,
  })
  return podBusyFactsOf({
    state: busy.status.state,
    toolName: busy.status.reason,
    setupRunning: busy.setupRunning,
    shellsRunning: shellRosterOf(busy.pluginViews).running,
    servicesRunning: runningServicesOf(busy.pluginViews),
  })
}

export const readPodBusy = async (args: {
  plane: ControlPlane
  session: BusySession
}): Promise<PodBusy> => podBusyOf(await readPodBusyFacts(args))

export const readPodStopBusy = async (args: {
  plane: ControlPlane
  session: BusySession
}): Promise<PodBusy> => podStopBusyOf(await readPodBusyFacts(args))

export const readPodResizeBusy = async (args: {
  plane: ControlPlane
  session: BusySession
}): Promise<PodBusy> => podResizeBusyOf(await readPodBusyFacts(args))

export const readPodRebootFacts = async (args: {
  plane: ControlPlane
  session: Pick<ControlSessionRow, 'sessionId' | 'mainThreadId'>
  terminalsHeld?: number | undefined
}): Promise<PodRebootFacts | undefined> => {
  const busy = await args.plane.readSessionBusy({
    sessionId: args.session.sessionId,
    threadId: args.session.mainThreadId,
  })
  const peersPlaced = await args.plane.podPeersPlaced({
    podSessionId: args.session.sessionId,
    excludeSessionId: args.session.sessionId,
  })
  return {
    state: busy.status.state,
    setupRunning: busy.setupRunning,
    shellsRunning: shellRosterOf(busy.pluginViews).running,
    servicesRunning: runningServicesOf(busy.pluginViews),
    backgroundAgents: 0,
    terminalsHeld: args.terminalsHeld ?? 0,
    peersPlaced,
  }
}
