import { createHash } from 'node:crypto'

import webPush from 'web-push'
import { z } from 'zod'

import { ENotifyDeviceKind, type AtlasNotification, type NotifyDevice } from '../model'
import type { NotificationTransport, NotifyResult } from '../port'

export const WEB_PUSH_TTL_S = 86_400

const TOPIC_LENGTH = 32

const APPLE_PUSH_HOST = 'web.push.apple.com'

export type WebPushVapid = { publicKey: string; privateKey: string; subject: string }

export type WebPushSubscription = {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export type WebPushSendOptions = {
  TTL: number
  vapidDetails: WebPushVapid
  topic?: string
}

export type WebPushSender = (args: {
  subscription: WebPushSubscription
  payload: string
  options: WebPushSendOptions
}) => Promise<{ statusCode: number }>

export type WebPushMessage =
  | { type: 'notification'; notification: AtlasNotification }
  | { type: 'clear'; sessionId: string }

const defaultSender: WebPushSender = async (args) =>
  webPush.sendNotification(args.subscription, args.payload, {
    TTL: args.options.TTL,
    vapidDetails: args.options.vapidDetails,
    ...(args.options.topic === undefined ? {} : { topic: args.options.topic }),
  })

const secretSchema = z.object({ p256dh: z.string().min(1), auth: z.string().min(1) })

const subscriptionOf = (device: NotifyDevice): WebPushSubscription | null => {
  if (device.secret === null) return null
  try {
    const parsed = secretSchema.safeParse(JSON.parse(device.secret))
    return parsed.success
      ? { endpoint: device.token, keys: { p256dh: parsed.data.p256dh, auth: parsed.data.auth } }
      : null
  } catch {
    return null
  }
}

export const webPushTopicOf = (sessionId: string): string =>
  createHash('sha256').update(sessionId).digest('hex').slice(0, TOPIC_LENGTH)

const appleEndpoint = (endpoint: string): boolean => {
  try {
    return new URL(endpoint).hostname === APPLE_PUSH_HOST
  } catch {
    return false
  }
}

const statusCodeOf = (failure: unknown): number | null => {
  if (typeof failure !== 'object' || failure === null || !('statusCode' in failure)) return null
  const status = failure.statusCode
  return typeof status === 'number' ? status : null
}

const isGone = (failure: unknown): boolean => {
  const status = statusCodeOf(failure)
  return status === 404 || status === 410
}

const resultOf = async (args: {
  send: WebPushSender
  device: NotifyDevice
  message: WebPushMessage
  vapid: WebPushVapid
}): Promise<NotifyResult> => {
  const subscription = subscriptionOf(args.device)
  if (subscription === null) return { deviceId: args.device.id, sent: false, gone: true }
  try {
    const reply = await args.send({
      subscription,
      payload: JSON.stringify(args.message),
      options: {
        TTL: WEB_PUSH_TTL_S,
        vapidDetails: args.vapid,
        ...(args.message.type === 'notification'
          ? { topic: webPushTopicOf(args.message.notification.sessionId) }
          : {}),
      },
    })
    return { deviceId: args.device.id, sent: reply.statusCode < 300 }
  } catch (failure) {
    return isGone(failure)
      ? { deviceId: args.device.id, sent: false, gone: true }
      : { deviceId: args.device.id, sent: false }
  }
}

export const webPushTransport = (args: {
  vapid: WebPushVapid
  send?: WebPushSender
}): NotificationTransport => {
  const send = args.send ?? defaultSender

  return {
    kind: ENotifyDeviceKind.WebPush,
    deliver: async ({ devices, notification }) =>
      Promise.all(
        devices.map((device) =>
          resultOf({
            send,
            device,
            message: { type: 'notification', notification },
            vapid: args.vapid,
          }),
        ),
      ),
    clear: async ({ devices, sessionId }) =>
      Promise.all(
        devices.map((device) =>
          appleEndpoint(device.token)
            ? Promise.resolve({ deviceId: device.id, sent: false })
            : resultOf({ send, device, message: { type: 'clear', sessionId }, vapid: args.vapid }),
        ),
      ),
  }
}
