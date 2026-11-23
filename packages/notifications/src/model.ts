import type { AtlasNotification } from '@dltech/atlas-core'

export type { AtlasNotification }

export enum ENotifyDeviceKind {
  WebPush = 'web-push',
  Expo = 'expo',
  ApnsMac = 'apns-mac',
}

export type NotifyDevice = {
  id: string
  kind: ENotifyDeviceKind
  token: string
  secret: string | null
}
