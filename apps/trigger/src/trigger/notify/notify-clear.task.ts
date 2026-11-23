import {
  NO_NOTIFY_OUTPUT,
  NOTIFY_CLEAR_TASK_ID,
  notifyClearPayloadSchema,
  type NotifyClearPayload,
  type NotifySendOutput,
} from '@dltech/atlas-jobs/notify'
import type { NotifyDevice, NotifyResult } from '@dltech/atlas-notifications'
import { schemaTask } from '@trigger.dev/sdk'
import '../init'
import { countsOf, settleDevices, withNotifyGraph, type NotifyGraph } from './notify-send-graph'

export const NOTIFY_CLEAR_MAX_DURATION_SECONDS = 30

export const NOTIFY_CLEAR_MAX_ATTEMPTS = 3

export const clearDevices = async (args: {
  graph: NotifyGraph
  devices: readonly NotifyDevice[]
  sessionId: string
}): Promise<readonly NotifyResult[]> => {
  const kinds = [...new Set(args.devices.map((device) => device.kind))]
  const cleared = await Promise.all(
    kinds.map((kind) => {
      const transport = args.graph.transports[kind]
      const ofKind = args.devices.filter((device) => device.kind === kind)
      if (transport === undefined || ofKind.length === 0) return Promise.resolve([])
      return transport.clear({ devices: ofKind, sessionId: args.sessionId })
    }),
  )
  return cleared.flat()
}

export const runNotifyClear = async (args: {
  graph: NotifyGraph
  payload: NotifyClearPayload
}): Promise<NotifySendOutput> => {
  const { graph, payload } = args
  const devices = await graph.devices.listEnabled({ userId: payload.userId })
  if (devices.length === 0) return NO_NOTIFY_OUTPUT

  const results = await clearDevices({ graph, devices, sessionId: payload.sessionId })
  await settleDevices({ graph, results, now: graph.now() })
  return countsOf(results)
}

export const notifyClearTask = schemaTask({
  id: NOTIFY_CLEAR_TASK_ID,
  schema: notifyClearPayloadSchema,
  maxDuration: NOTIFY_CLEAR_MAX_DURATION_SECONDS,
  retry: { maxAttempts: NOTIFY_CLEAR_MAX_ATTEMPTS },
  run: async (payload) => withNotifyGraph((graph) => runNotifyClear({ graph, payload })),
})
