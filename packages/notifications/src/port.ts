import type { AtlasNotification, ENotifyDeviceKind, NotifyDevice } from './model'

export type NotifyResult = { deviceId: string; sent: boolean; gone?: boolean }

export interface NotificationTransport {
  readonly kind: ENotifyDeviceKind
  deliver(args: {
    devices: readonly NotifyDevice[]
    notification: AtlasNotification
  }): Promise<readonly NotifyResult[]>
  clear(args: {
    devices: readonly NotifyDevice[]
    sessionId: string
  }): Promise<readonly NotifyResult[]>
}
