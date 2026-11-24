import { ENotifyMoment, notifySettingsOf, routineFailureNotificationOf } from '@dltech/atlas-core'
import {
  countsOf,
  deliverToKinds,
  settleDevices,
  type NotifyGraph,
} from '../notify/notify-send-graph'

export type RoutineFailure = {
  routineId: string
  routineName: string
  userId: string
  reason: string
}

export const notifyRoutineFailure = async (args: {
  graph: NotifyGraph
  failure: RoutineFailure
}): Promise<{ sent: number; gone: number }> => {
  const { graph, failure } = args
  const now = graph.now()
  const settings = notifySettingsOf({
    values: await graph.settings.read({ userId: failure.userId }),
  })
  const notification = routineFailureNotificationOf({
    routineId: failure.routineId,
    routineName: failure.routineName,
    reason: failure.reason,
    enabled: settings.enabled(ENotifyMoment.TurnFailed),
    quiet: settings.quiet({ now }),
    now,
  })
  if (notification === null) return { sent: 0, gone: 0 }
  const devices = await graph.devices.listEnabled({ userId: failure.userId })
  if (devices.length === 0) return { sent: 0, gone: 0 }
  const results = await deliverToKinds({ graph, devices, notification })
  await settleDevices({ graph, results, now })
  return countsOf(results)
}
