import { getExpoPushToken, type EPushSkipReason } from './expo-push-token'
import type { IPushApi } from './push-api'

export type { EPushSkipReason }

export type TPushRegistration =
  | { status: 'registered'; token: string }
  | { status: 'skipped'; reason: EPushSkipReason }

export const registerPushDevice = async ({
  pushApi,
}: {
  pushApi: IPushApi
}): Promise<TPushRegistration> => {
  const result = await getExpoPushToken()
  if (result.status === 'skipped') return result
  await pushApi.register({ token: result.token, platform: result.platform })
  return { status: 'registered', token: result.token }
}
