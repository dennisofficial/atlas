import type { ControlPlane, ControlSessionRow } from '@dltech/atlas-control'
import { podBusyFactsOf, podBusyOf, type PodBusy } from '@dltech/atlas-core'
import { shellRosterOf } from '@dltech/atlas-plugin-shells/client'
import { servicesOfView } from '@dltech/atlas-plugin-services/client'

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
      servicesRunning: servicesOfView(busy.pluginViews).filter((row) => row.status === 'running')
        .length,
    }),
  )
}
