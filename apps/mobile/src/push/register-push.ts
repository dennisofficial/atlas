import { getExpoPushToken, type EPushSkipReason } from './expo-push-token'
import type { IPushApi } from './push-api'

export type { EPushSkipReason }

export const PUSH_DEVICE_LABEL = 'iPhone'

export type TPushRegistration =
  | { status: 'registered'; token: string; deviceId: string }
  | { status: 'skipped'; reason: EPushSkipReason }

export const registerPushDevice = async ({
  pushApi,
  clientId,
}: {
  pushApi: IPushApi
  clientId: string
}): Promise<TPushRegistration> => {
  const result = await getExpoPushToken()
  if (result.status === 'skipped') return result
  const { id } = await pushApi.register({
    token: result.token,
    clientId,
    label: PUSH_DEVICE_LABEL,
  })
  return { status: 'registered', token: result.token, deviceId: id }
}
