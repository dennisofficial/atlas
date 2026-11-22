import type { ControlPlane, ControlSessionRow } from '@dltech/atlas-control'
import { podBusyFactsOf, podBusyOf, type PodBusy, type PodRebootFacts } from '@dltech/atlas-core'
import { shellRosterOf } from '@dltech/atlas-plugin-shells/client'
import { servicesOfView } from '@dltech/atlas-plugin-services/client'

const runningServicesOf = (views: Readonly<Record<string, unknown>>): number =>
  servicesOfView(views).filter((row) => row.status === 'running').length

export const readPodBusy = async (args: {
  plane: ControlPlane
  session: Pick<ControlSessionRow, 'sessionId' | 'mainThreadId'>
}): Promise<PodBusy> => {
  const busy = await args.plane.readSessionBusy({
    sessionId: args.session.sessionId,
    threadId: args.session.mainThreadId,
  })
  return podBusyOf(
    podBusyFactsOf({
      state: busy.status.state,
      shellsRunning: shellRosterOf(busy.pluginViews).running,
      servicesRunning: runningServicesOf(busy.pluginViews),
    }),
  )
}

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
    shellsRunning: shellRosterOf(busy.pluginViews).running,
    servicesRunning: runningServicesOf(busy.pluginViews),
    backgroundAgents: 0,
    terminalsHeld: args.terminalsHeld ?? 0,
    peersPlaced,
  }
}
