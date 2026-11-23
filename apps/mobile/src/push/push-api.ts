import type { ApiClient } from '@dltech/atlas-api-router'
import { ENotifyDeviceKind } from '@dltech/atlas-notifications'
import type { RegisterNotifyDeviceInput } from '@dltech/atlas-wire'

export interface IPushApi {
  register: (input: { token: string; clientId: string; label: string }) => Promise<{ id: string }>
  unregister: (input: { deviceId: string }) => Promise<void>
  sendTest: () => Promise<{ devices: number }>
}

export const expoDeviceOf = (args: {
  token: string
  clientId: string
  label: string
}): RegisterNotifyDeviceInput => ({
  kind: ENotifyDeviceKind.Expo,
  clientId: args.clientId,
  token: args.token,
  secret: null,
  label: args.label,
})

export const createPushApi = ({ client }: { client: ApiClient }): IPushApi => ({
  register: async (input) => client.notifications.registerDevice.mutate(expoDeviceOf(input)),
  unregister: async ({ deviceId }) => {
    await client.notifications.unregisterDevice.mutate({ deviceId })
  },
  sendTest: () => client.notifications.sendTest.mutate({}),
})
