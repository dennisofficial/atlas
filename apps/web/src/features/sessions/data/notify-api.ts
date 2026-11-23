import { createApiClient } from '@dltech/atlas-api-router'
import type {
  ListNotifyDevicesOutput,
  RegisterNotifyDeviceInput,
  ReportNotifyPresenceInput,
  SetNotifyDeviceEnabledInput,
} from '@dltech/atlas-wire/web'

import { apiBaseUrl } from '@/lib/api-base-url'
import { api, cloudCall } from '@/lib/api-client'

const keepaliveFetch: typeof fetch = Object.assign(
  (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
    fetch(input, { ...init, keepalive: true }),
  { preconnect: globalThis.fetch.preconnect },
)

const awayApi = createApiClient({
  baseUrl: apiBaseUrl(),
  credentials: 'include',
  fetchFn: keepaliveFetch,
})

export const reportPresence = (input: ReportNotifyPresenceInput) =>
  cloudCall(api.notifications.reportPresence.mutate(input))

export const reportPresenceAway = (input: ReportNotifyPresenceInput) =>
  cloudCall(awayApi.notifications.reportPresence.mutate(input))

export const notificationsWebPushKey = () => cloudCall(api.notifications.webPushKey.query({}))

export const registerNotifyDevice = (input: RegisterNotifyDeviceInput) =>
  cloudCall(api.notifications.registerDevice.mutate(input))

export const sendTestNotification = () => cloudCall(api.notifications.sendTest.mutate({}))

export const listNotifyDevices = (): Promise<ListNotifyDevicesOutput> =>
  cloudCall(api.notifications.listDevices.query({}))

export const setNotifyDeviceEnabled = (input: SetNotifyDeviceEnabledInput): Promise<void> =>
  cloudCall(api.notifications.setDeviceEnabled.mutate(input))
