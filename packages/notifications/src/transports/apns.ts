import { createSign } from 'node:crypto'
import { connect } from 'node:http2'

import { z } from 'zod'

import {
  ENotifyDeviceKind,
  NOTIFY_DATA_CLEAR_SESSION_KEY,
  NOTIFY_DATA_SEQ_KEY,
  NOTIFY_DATA_SESSION_KEY,
  type AtlasNotification,
  type NotifyDevice,
} from '../model'
import type { NotificationTransport, NotifyResult } from '../port'

export const APNS_ORIGIN = 'https://api.push.apple.com'

export const APNS_TOKEN_TTL_MS = 50 * 60_000

export const APNS_COLLAPSE_LIMIT = 64

export type ApnsRequest = {
  token: string
  headers: Record<string, string>
  body: string
}

export type ApnsReply = { status: number; reason?: string }

export type ApnsSender = (request: ApnsRequest) => Promise<ApnsReply>

export type ApnsMessage =
  | { type: 'notification'; notification: AtlasNotification }
  | { type: 'clear'; sessionId: string }

const reasonSchema = z.object({ reason: z.string().min(1) })

const parseReason = (text: string): string | undefined => {
  try {
    const parsed = reasonSchema.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data.reason : undefined
  } catch {
    return undefined
  }
}

const defaultSender: ApnsSender = async ({ token, headers, body }) =>
  new Promise<ApnsReply>((resolve, reject) => {
    const session = connect(APNS_ORIGIN)
    const fail = (error: Error): void => {
      session.close()
      reject(error)
    }
    session.once('error', fail)
    const stream = session.request({
      ':method': 'POST',
      ':path': `/3/device/${token}`,
      ...headers,
    })
    let status = 0
    let text = ''
    stream.setEncoding('utf8')
    stream.on('response', (responseHeaders) => {
      const value = responseHeaders[':status']
      status = typeof value === 'number' ? value : 0
    })
    stream.on('data', (chunk: string) => {
      text += chunk
    })
    stream.on('error', fail)
    stream.on('end', () => {
      session.close()
      const reason = parseReason(text)
      resolve(reason === undefined ? { status } : { status, reason })
    })
    stream.end(body)
  })

const base64UrlOf = (value: string): string => Buffer.from(value).toString('base64url')

const providerJwtOf = (args: {
  keyP8: string
  keyId: string
  teamId: string
  issuedAt: number
}): string => {
  const header = base64UrlOf(JSON.stringify({ alg: 'ES256', kid: args.keyId }))
  const claims = base64UrlOf(JSON.stringify({ iss: args.teamId, iat: args.issuedAt }))
  const signature = createSign('sha256')
    .update(`${header}.${claims}`)
    .sign({ key: args.keyP8, dsaEncoding: 'ieee-p1363' })
    .toString('base64url')
  return `${header}.${claims}.${signature}`
}

const providerTokenOf = (args: {
  keyP8: string
  keyId: string
  teamId: string
  clock: () => number
}): (() => string) => {
  let cached: { token: string; issuedAt: number } | undefined
  return () => {
    const now = args.clock()
    if (cached !== undefined && now - cached.issuedAt < APNS_TOKEN_TTL_MS) return cached.token
    const token = providerJwtOf({
      keyP8: args.keyP8,
      keyId: args.keyId,
      teamId: args.teamId,
      issuedAt: Math.floor(now / 1000),
    })
    cached = { token, issuedAt: now }
    return token
  }
}

export const apnsCollapseIdOf = (sessionId: string): string => {
  const bytes = Buffer.from(sessionId)
  return bytes.length <= APNS_COLLAPSE_LIMIT
    ? sessionId
    : bytes.subarray(0, APNS_COLLAPSE_LIMIT).toString()
}

const requestOf = (args: {
  device: NotifyDevice
  message: ApnsMessage
  topic: string
  authorization: string
}): ApnsRequest => {
  const common = {
    authorization: args.authorization,
    'apns-topic': args.topic,
  }
  if (args.message.type === 'clear')
    return {
      token: args.device.token,
      headers: { ...common, 'apns-push-type': 'background', 'apns-priority': '5' },
      body: JSON.stringify({
        aps: { 'content-available': 1 },
        [NOTIFY_DATA_CLEAR_SESSION_KEY]: args.message.sessionId,
      }),
    }
  const notification = args.message.notification
  return {
    token: args.device.token,
    headers: {
      ...common,
      'apns-push-type': 'alert',
      'apns-collapse-id': apnsCollapseIdOf(notification.sessionId),
    },
    body: JSON.stringify({
      aps: {
        alert: { title: notification.title, body: notification.body },
        'thread-id': notification.sessionId,
        sound: 'default',
      },
      [NOTIFY_DATA_SESSION_KEY]: notification.sessionId,
      [NOTIFY_DATA_SEQ_KEY]: notification.seq,
    }),
  }
}

const isGone = (reply: ApnsReply): boolean =>
  reply.status === 410 || reply.reason === 'Unregistered' || reply.reason === 'BadDeviceToken'

const resultOf = async (args: {
  send: ApnsSender
  request: ApnsRequest
  deviceId: string
}): Promise<NotifyResult> => {
  try {
    const reply = await args.send(args.request)
    if (isGone(reply)) return { deviceId: args.deviceId, sent: false, gone: true }
    return { deviceId: args.deviceId, sent: reply.status === 200 }
  } catch {
    return { deviceId: args.deviceId, sent: false }
  }
}

export const apnsTransport = (args: {
  keyP8: string
  keyId: string
  teamId: string
  topic: string
  send?: ApnsSender | undefined
  clock?: (() => number) | undefined
}): NotificationTransport => {
  const send = args.send ?? defaultSender
  const providerToken = providerTokenOf({
    keyP8: args.keyP8,
    keyId: args.keyId,
    teamId: args.teamId,
    clock: args.clock ?? Date.now,
  })

  const toDevice = (device: NotifyDevice, message: ApnsMessage): Promise<NotifyResult> =>
    resultOf({
      send,
      deviceId: device.id,
      request: requestOf({
        device,
        message,
        topic: args.topic,
        authorization: `bearer ${providerToken()}`,
      }),
    })

  return {
    kind: ENotifyDeviceKind.ApnsMac,
    deliver: async ({ devices, notification }) =>
      Promise.all(
        devices.map((device) => toDevice(device, { type: 'notification', notification })),
      ),
    clear: async ({ devices, sessionId }) =>
      Promise.all(devices.map((device) => toDevice(device, { type: 'clear', sessionId }))),
  }
}
