import { mock } from 'bun:test'

import type { ListNotifyDevicesOutput } from '@dltech/atlas-wire/web'

export const notifyApiFake = {
  reportPresence: mock(async () => undefined),
  reportPresenceAway: mock(async () => undefined),
  notificationsWebPushKey: mock(async () => ({ publicKey: null })),
  registerNotifyDevice: mock(async () => ({ id: 'device-fake' })),
  sendTestNotification: mock(async () => undefined),
  listNotifyDevices: mock(async (): Promise<ListNotifyDevicesOutput> => ({ devices: [] })),
  setNotifyDeviceEnabled: mock(async () => undefined),
  reportInAppShown: mock(async () => undefined),
}
