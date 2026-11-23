import {
  EClientSurface,
  ENotifyDeviceKind,
  ENotifyInAppKind,
  ENotifyMoment,
  ENotifyTrackEvent,
} from '@dltech/atlas-core'
import { z } from 'zod'

export const reportNotifyPresenceInputSchema = z.strictObject({
  clientId: z.string().min(1).max(64),
  surface: z.enum(EClientSurface),
  sessionId: z.string().min(1).nullable(),
  foreground: z.boolean(),
})
export type ReportNotifyPresenceInput = z.infer<typeof reportNotifyPresenceInputSchema>

export const notifyDeviceKindSchema = z.enum(ENotifyDeviceKind)

export const registerNotifyDeviceInputSchema = z.strictObject({
  kind: notifyDeviceKindSchema,
  clientId: z.string().min(1).max(64),
  token: z.string().min(1).max(4096),
  secret: z.string().min(1).max(4096).nullable(),
  label: z.string().min(1).max(64),
})
export type RegisterNotifyDeviceInput = z.infer<typeof registerNotifyDeviceInputSchema>

export const registerNotifyDeviceOutputSchema = z.strictObject({ id: z.string().min(1) })
export type RegisterNotifyDeviceOutput = z.infer<typeof registerNotifyDeviceOutputSchema>

export const unregisterNotifyDeviceInputSchema = z.strictObject({
  deviceId: z.string().min(1),
})
export type UnregisterNotifyDeviceInput = z.infer<typeof unregisterNotifyDeviceInputSchema>

export const setNotifyDeviceEnabledInputSchema = z.strictObject({
  deviceId: z.string().min(1),
  enabled: z.boolean(),
})
export type SetNotifyDeviceEnabledInput = z.infer<typeof setNotifyDeviceEnabledInputSchema>

export const notifyDeviceViewSchema = z.strictObject({
  id: z.string().min(1),
  kind: notifyDeviceKindSchema,
  label: z.string(),
  enabled: z.boolean(),
  lastSeenAt: z.iso.datetime(),
})
export type NotifyDeviceView = z.infer<typeof notifyDeviceViewSchema>

export const listNotifyDevicesOutputSchema = z.strictObject({
  devices: z.array(notifyDeviceViewSchema),
})
export type ListNotifyDevicesOutput = z.infer<typeof listNotifyDevicesOutputSchema>

export const notifyWebPushKeyOutputSchema = z.strictObject({
  publicKey: z.string().min(1).nullable(),
})
export type NotifyWebPushKeyOutput = z.infer<typeof notifyWebPushKeyOutputSchema>

export const sendTestNotificationOutputSchema = z.strictObject({
  devices: z.number().int().nonnegative(),
})
export type SendTestNotificationOutput = z.infer<typeof sendTestNotificationOutputSchema>

export const notifyTrackDeviceKindSchema = z.union([
  z.enum(ENotifyDeviceKind),
  z.enum(ENotifyInAppKind),
])
export type NotifyTrackDeviceKind = z.infer<typeof notifyTrackDeviceKindSchema>

export const notifyTrackEventSchema = z.enum(ENotifyTrackEvent)
export type NotifyTrackEventName = z.infer<typeof notifyTrackEventSchema>

export const trackNotificationInputSchema = z.strictObject({
  event: notifyTrackEventSchema,
  sessionId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  moment: z.enum(ENotifyMoment),
  deviceKind: notifyTrackDeviceKindSchema,
  sentAt: z.iso.datetime().optional(),
})
export type TrackNotificationInput = z.infer<typeof trackNotificationInputSchema>
