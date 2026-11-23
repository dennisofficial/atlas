import { ENotifyMode, notifyPlanOf } from '@dltech/atlas-core'
import {
  NO_NOTIFY_OUTPUT,
  NOTIFY_SEND_TASK_ID,
  notifySendPayloadSchema,
  type NotifySendOutput,
  type NotifySendPayload,
} from '@dltech/atlas-jobs/notify'
import { schemaTask } from '@trigger.dev/sdk'
import '../init'
import {
  countsOf,
  deliverToKinds,
  settleDevices,
  withNotifyGraph,
  type NotifyGraph,
} from './notify-send-graph'

export const NOTIFY_SEND_MAX_DURATION_SECONDS = 30

export const NOTIFY_SEND_MAX_ATTEMPTS = 3

export const runNotifySend = async (args: {
  graph: NotifyGraph
  payload: NotifySendPayload
}): Promise<NotifySendOutput> => {
  const { graph, payload } = args
  const session = await graph.session.read({ sessionId: payload.sessionId })
  if (session === null) return NO_NOTIFY_OUTPUT

  const now = graph.now()
  const presence = await graph.presence.read({ userId: session.userId, now })
  const devices = await graph.devices.listEnabled({ userId: session.userId })
  const plan = notifyPlanOf({
    facts: {
      moment: payload.moment,
      sessionId: payload.sessionId,
      sessionTitle: session.title,
      seq: payload.seq,
      readSeq: session.readSeq,
      presence,
      devices: devices.length,
      quiet: false,
      enabled: true,
      now,
    },
  })
  if (plan === null || plan.mode !== ENotifyMode.Push) return NO_NOTIFY_OUTPUT

  const results = await deliverToKinds({ graph, devices, notification: plan.notification })
  await settleDevices({ graph, results, now })
  return countsOf(results)
}

export const notifySendTask = schemaTask({
  id: NOTIFY_SEND_TASK_ID,
  schema: notifySendPayloadSchema,
  maxDuration: NOTIFY_SEND_MAX_DURATION_SECONDS,
  retry: { maxAttempts: NOTIFY_SEND_MAX_ATTEMPTS },
  run: async (payload) => withNotifyGraph((graph) => runNotifySend({ graph, payload })),
})
