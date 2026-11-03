import type { ApiClient } from '@dltech/atlas-api-router'
import type { EPushPlatform } from '@dltech/atlas-wire/web'

export interface IPushApi {
  register: (input: { token: string; platform: EPushPlatform }) => Promise<void>
  unregister: (input: { token: string }) => Promise<void>
  sendTest: () => Promise<{ devices: number }>
}

export const createPushApi = ({ client }: { client: ApiClient }): IPushApi => ({
  register: async ({ token, platform }) => {
    await client.pushDevices.register.mutate({ token, platform })
  },
  unregister: async ({ token }) => {
    await client.pushDevices.unregister.mutate({ token })
  },
  sendTest: () => client.pushDevices.sendTest.mutate({}),
})
