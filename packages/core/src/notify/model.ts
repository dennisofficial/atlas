import { z } from 'zod'

import { ENotifyMoment } from './moment'

export enum ENotifyDeviceKind {
  WebPush = 'web-push',
  Expo = 'expo',
  ApnsMac = 'apns-mac',
}

export enum ENotifyInAppKind {
  Web = 'in-app-web',
  Ios = 'in-app-ios',
}

export enum ENotifyTrackEvent {
  Delivered = 'delivered',
  Opened = 'opened',
  Dismissed = 'dismissed',
  InAppShown = 'in-app-shown',
}

export type AtlasNotification = {
  sessionId: string
  seq: number
  moment: ENotifyMoment
  title: string
  body: string
  at: string
  routineId?: string | undefined
  silent?: boolean | undefined
}

export const atlasNotificationSchema = z.object({
  sessionId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  moment: z.enum(ENotifyMoment),
  title: z.string().min(1),
  body: z.string().min(1),
  at: z.string().min(1),
  routineId: z.string().min(1).optional(),
  silent: z.boolean().optional(),
})
