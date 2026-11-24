import { ENotifyMoment, type AtlasNotification } from '@dltech/atlas-core'
import {
  NO_NOTIFY_OUTPUT,
  NOTIFY_TEST_TASK_ID,
  notifyTestPayloadSchema,
  type NotifySendOutput,
  type NotifyTestPayload,
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

export const NOTIFY_TEST_SESSION_ID = 'notify-test'

export const NOTIFY_TEST_TITLE = 'Atlas'

export const NOTIFY_TEST_BODY = 'Test notification'

export const NOTIFY_TEST_MAX_DURATION_SECONDS = 30

export const NOTIFY_TEST_MAX_ATTEMPTS = 3

export const testNotificationOf = (at: string): AtlasNotification => ({
  sessionId: NOTIFY_TEST_SESSION_ID,
  seq: 0,
  moment: ENotifyMoment.TurnFinished,
  title: NOTIFY_TEST_TITLE,
  body: NOTIFY_TEST_BODY,
  at,
})

export const runNotifyTest = async (args: {
  graph: NotifyGraph
  payload: NotifyTestPayload
}): Promise<NotifySendOutput> => {
  const { graph, payload } = args
  const devices = await graph.devices.listEnabled({ userId: payload.userId })
  if (devices.length === 0) return NO_NOTIFY_OUTPUT

  const now = graph.now()
  const results = await deliverToKinds({
    graph,
    devices,
    notification: testNotificationOf(now),
  })
  await settleDevices({ graph, results, now })
  return countsOf(results)
}

export const notifyTestTask = schemaTask({
  id: NOTIFY_TEST_TASK_ID,
  schema: notifyTestPayloadSchema,
  maxDuration: NOTIFY_TEST_MAX_DURATION_SECONDS,
  retry: { maxAttempts: NOTIFY_TEST_MAX_ATTEMPTS },
  run: async (payload) => withNotifyGraph((graph) => runNotifyTest({ graph, payload })),
})
