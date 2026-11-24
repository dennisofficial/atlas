import { ENotifySkip, ENotifyVerdict } from '@dltech/atlas-core'
import type { NotifySendPayload } from '@dltech/atlas-jobs/notify'
import type { NotifyDevice, NotifyResult } from '@dltech/atlas-notifications'
import type { ProductAnalytics, ProductAnalyticsProperties } from '@dltech/atlas-observability'

const captureOf = (args: {
  analytics: ProductAnalytics
  userId: string
  event: string
  properties: ProductAnalyticsProperties
}): void => {
  try {
    args.analytics.capture({ userId: args.userId, event: args.event, properties: args.properties })
  } catch {
    // A run reports its outcome; analytics must never fault it.
  }
}

const baseOf = (payload: NotifySendPayload): ProductAnalyticsProperties => ({
  moment: payload.moment,
  session_id: payload.sessionId,
  seq: payload.seq,
})

const endedAtOf = (payload: NotifySendPayload): ProductAnalyticsProperties =>
  payload.endedAt === undefined ? {} : { ended_at: payload.endedAt }

const latencyOf = (args: {
  payload: NotifySendPayload
  now: string
}): ProductAnalyticsProperties =>
  args.payload.endedAt === undefined
    ? {}
    : { latency_ms: Date.parse(args.now) - Date.parse(args.payload.endedAt) }

export const captureNotificationMoment = (args: {
  analytics: ProductAnalytics
  userId: string
  payload: NotifySendPayload
}): void => {
  const holdMs = args.payload.holdMs ?? 0
  captureOf({
    analytics: args.analytics,
    userId: args.userId,
    event: 'notification_moment',
    properties: {
      ...baseOf(args.payload),
      verdict: holdMs > 0 ? ENotifyVerdict.Hold : ENotifyVerdict.Send,
      hold_ms: holdMs,
      pending_kinds: args.payload.pending ?? [],
      operator_turn: args.payload.operatorTurn ?? true,
      ...endedAtOf(args.payload),
    },
  })
}

export const captureNotificationSkipped = (args: {
  analytics: ProductAnalytics
  userId: string
  payload: NotifySendPayload
  reason: ENotifySkip
  nested: boolean
}): void => {
  captureOf({
    analytics: args.analytics,
    userId: args.userId,
    event: 'notification_skipped',
    properties: {
      ...baseOf(args.payload),
      reason: args.reason,
      held: (args.payload.holdMs ?? 0) > 0,
      nested: args.nested,
    },
  })
}

export const captureNotificationInApp = (args: {
  analytics: ProductAnalytics
  userId: string
  payload: NotifySendPayload
}): void => {
  captureOf({
    analytics: args.analytics,
    userId: args.userId,
    event: 'notification_in_app',
    properties: { ...baseOf(args.payload), source: 'server' },
  })
}

export const captureNotificationSent = (args: {
  analytics: ProductAnalytics
  userId: string
  payload: NotifySendPayload
  devices: readonly NotifyDevice[]
  results: readonly NotifyResult[]
  sound: boolean
  now: string
}): void => {
  const kindOf = new Map(args.devices.map((device) => [device.id, device.kind]))
  for (const result of args.results) {
    captureOf({
      analytics: args.analytics,
      userId: args.userId,
      event: 'notification_sent',
      properties: {
        ...baseOf(args.payload),
        device_kind: kindOf.get(result.deviceId) ?? null,
        accepted: result.sent,
        gone: result.gone === true,
        sound: args.sound,
        held_ms: args.payload.holdMs ?? 0,
        ...latencyOf({ payload: args.payload, now: args.now }),
      },
    })
  }
}
