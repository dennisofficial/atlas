import { z } from 'zod'

import {
  ENotifyDeviceKind,
  NOTIFY_DATA_CLEAR_SESSION_KEY,
  NOTIFY_DATA_SEQ_KEY,
  NOTIFY_DATA_SESSION_KEY,
  routineDataOf,
  type AtlasNotification,
  type NotifyDevice,
} from '../model'
import type { NotificationTransport, NotifyResult } from '../port'

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

export const EXPO_PUSH_BATCH_SIZE = 100

export type ExpoMessage =
  | {
      to: string
      title: string
      body: string
      sound?: 'default'
      collapseId: string
      threadId: string
      data: { sessionId: string; seq: number }
    }
  | { to: string; contentAvailable: true; data: { clearSessionId: string } }

export type ExpoRequest = {
  method: string
  headers: Record<string, string>
  body: string
}

export type ExpoFetch = (
  input: string,
  init: ExpoRequest,
) => Promise<{ status: number; json(): Promise<unknown> }>

const ticketSchema = z.object({
  status: z.string(),
  details: z.object({ error: z.string().optional() }).optional(),
})

const replySchema = z.object({ data: z.array(ticketSchema) })

type ExpoTicket = z.infer<typeof ticketSchema>

const defaultFetch: ExpoFetch = async (input, init) => fetch(input, init)

const isGone = (ticket: ExpoTicket): boolean =>
  ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered'

const batchesOf = <T>(items: readonly T[]): T[][] => {
  const batches: T[][] = []
  for (let start = 0; start < items.length; start += EXPO_PUSH_BATCH_SIZE) {
    batches.push(items.slice(start, start + EXPO_PUSH_BATCH_SIZE))
  }
  return batches
}

const alertMessageOf = (device: NotifyDevice, notification: AtlasNotification): ExpoMessage => ({
  to: device.token,
  title: notification.title,
  body: notification.body,
  ...(notification.silent === true ? {} : { sound: 'default' as const }),
  collapseId: notification.sessionId,
  threadId: notification.sessionId,
  data: {
    [NOTIFY_DATA_SESSION_KEY]: notification.sessionId,
    [NOTIFY_DATA_SEQ_KEY]: notification.seq,
    ...routineDataOf(notification),
  },
})

const clearMessageOf = (device: NotifyDevice, sessionId: string): ExpoMessage => ({
  to: device.token,
  contentAvailable: true,
  data: { [NOTIFY_DATA_CLEAR_SESSION_KEY]: sessionId },
})

type ExpoEntry = { device: NotifyDevice; message: ExpoMessage }

export const expoTransport = (args: {
  accessToken?: string | undefined
  fetch?: ExpoFetch | undefined
}): NotificationTransport => {
  const send = args.fetch ?? defaultFetch
  const headers: Record<string, string> = {
    accept: 'application/json',
    'accept-encoding': 'gzip, deflate',
    'content-type': 'application/json',
    ...(args.accessToken === undefined || args.accessToken === ''
      ? {}
      : { authorization: `Bearer ${args.accessToken}` }),
  }

  const unsent = (entries: readonly ExpoEntry[], gone: boolean): NotifyResult[] =>
    entries.map((entry) => ({
      deviceId: entry.device.id,
      sent: false,
      ...(gone ? { gone: true } : {}),
    }))

  const postBatch = async (entries: readonly ExpoEntry[]): Promise<readonly NotifyResult[]> => {
    let reply: unknown
    try {
      const response = await send(EXPO_PUSH_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(entries.map((entry) => entry.message)),
      })
      if (response.status >= 300) return unsent(entries, false)
      reply = await response.json()
    } catch {
      return unsent(entries, false)
    }
    const parsed = replySchema.safeParse(reply)
    if (!parsed.success || parsed.data.data.length !== entries.length) return unsent(entries, false)
    return entries.map((entry, index) => {
      const ticket = parsed.data.data[index]
      if (ticket === undefined) return { deviceId: entry.device.id, sent: false }
      if (isGone(ticket)) return { deviceId: entry.device.id, sent: false, gone: true }
      return { deviceId: entry.device.id, sent: ticket.status === 'ok' }
    })
  }

  const post = async (entries: readonly ExpoEntry[]): Promise<readonly NotifyResult[]> => {
    const batches = await Promise.all(batchesOf(entries).map((batch) => postBatch(batch)))
    return batches.flat()
  }

  return {
    kind: ENotifyDeviceKind.Expo,
    deliver: async ({ devices, notification }) =>
      post(devices.map((device) => ({ device, message: alertMessageOf(device, notification) }))),
    clear: async ({ devices, sessionId }) =>
      post(devices.map((device) => ({ device, message: clearMessageOf(device, sessionId) }))),
  }
}
