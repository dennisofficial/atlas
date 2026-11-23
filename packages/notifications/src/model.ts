import type { AtlasNotification, ENotifyDeviceKind } from '@dltech/atlas-core'

export type { AtlasNotification }

export { ENotifyDeviceKind } from '@dltech/atlas-core'

export type NotifyDevice = {
  id: string
  kind: ENotifyDeviceKind
  token: string
  secret: string | null
}

export const NOTIFY_DATA_SESSION_KEY = 'sessionId'

export const NOTIFY_DATA_SEQ_KEY = 'seq'

export const NOTIFY_DATA_ROUTINE_KEY = 'routineId'

export const routineDataOf = (notification: AtlasNotification): Record<string, string> =>
  notification.routineId === undefined ? {} : { [NOTIFY_DATA_ROUTINE_KEY]: notification.routineId }

export const NOTIFY_DATA_CLEAR_SESSION_KEY = 'clearSessionId'
