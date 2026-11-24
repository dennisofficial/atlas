import { ENotifyMode, notifyPlanOf, notifySettingsOf, pushNotificationOf } from '@dltech/atlas-core'
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
  captureNotificationInApp,
  captureNotificationMoment,
  captureNotificationSent,
  captureNotificationSkipped,
} from './notify-metrics'
import {
  countsOf,
  deliverToKinds,
  settleDevices,
  withNotifyGraph,
  type NotifyGraph,
} from './notify-send-graph'

export const NOTIFY_SEND_MAX_DURATION_SECONDS = 30

export const NOTIFY_SEND_MAX_ATTEMPTS = 3

const supersededOf = async (args: {
  graph: NotifyGraph
  payload: NotifySendPayload
  mainThreadId: string
}): Promise<boolean> =>
  args.payload.holdMs === undefined || args.payload.holdMs === 0
    ? false
    : await args.graph.turns.startedAfter({ threadId: args.mainThreadId, seq: args.payload.seq })

export const runNotifySend = async (args: {
  graph: NotifyGraph
  payload: NotifySendPayload
}): Promise<NotifySendOutput> => {
  const { graph, payload } = args
  const session = await graph.session.read({ sessionId: payload.sessionId })
  if (session === null) return NO_NOTIFY_OUTPUT

  captureNotificationMoment({ analytics: graph.analytics, userId: session.userId, payload })

  const now = graph.now()
  const superseded = await supersededOf({ graph, payload, mainThreadId: session.mainThreadId })
  const presence = await graph.presence.read({ userId: session.userId, now })
  const devices = await graph.devices.listEnabled({ userId: session.userId })
  const settings = notifySettingsOf({
    values: await graph.settings.read({ userId: session.userId }),
  })
  const nested = session.nested && session.spawnedBySessionId !== null
  const plan = notifyPlanOf({
    facts: {
      moment: payload.moment,
      sessionId: payload.sessionId,
      sessionTitle: session.title,
      seq: payload.seq,
      readSeq: session.readSeq,
      presence,
      devices: devices.length,
      quiet: settings.quiet({ now }),
      enabled: settings.enabled(payload.moment),
      superseded,
      nested,
      operatorTurn: payload.operatorTurn ?? true,
      recentPush: false,
      now,
    },
  })
  if (plan.mode === ENotifyMode.Silent) {
    captureNotificationSkipped({
      analytics: graph.analytics,
      userId: session.userId,
      payload,
      reason: plan.reason,
      nested,
    })
    return NO_NOTIFY_OUTPUT
  }
  if (plan.mode === ENotifyMode.InApp)
    captureNotificationInApp({ analytics: graph.analytics, userId: session.userId, payload })
  const notification = pushNotificationOf(plan)
  if (notification === null) return NO_NOTIFY_OUTPUT

  const sound = await graph.sound.claim({ userId: session.userId })
  const results = await deliverToKinds({
    graph,
    devices,
    notification: sound ? notification : { ...notification, silent: true },
  })
  await settleDevices({ graph, results, now })
  captureNotificationSent({
    analytics: graph.analytics,
    userId: session.userId,
    payload,
    devices,
    results,
    sound,
    now,
  })
  return countsOf(results)
}

export const notifySendTask = schemaTask({
  id: NOTIFY_SEND_TASK_ID,
  schema: notifySendPayloadSchema,
  maxDuration: NOTIFY_SEND_MAX_DURATION_SECONDS,
  retry: { maxAttempts: NOTIFY_SEND_MAX_ATTEMPTS },
  run: async (payload) => withNotifyGraph((graph) => runNotifySend({ graph, payload })),
})
