import type { AtlasNotification, ENotifyDeviceKind } from '@dltech/atlas-core'

export type { AtlasNotification }

export { ENotifyDeviceKind } from '@dltech/atlas-core'

export type NotifyDevice = {
  id: string
  kind: ENotifyDeviceKind
  token: string
  secret: string | null
}
