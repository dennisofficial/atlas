import type { ApiClient } from '@dltech/atlas-api-router'
import { useEffect, useState } from 'react'
import { AppState } from 'react-native'

import { installClientId } from '../storage/install-client-id'
import { getExpoPushToken } from './expo-push-token'
import { createPushApi } from './push-api'
import {
  EPushRegistrationStatus,
  shouldRegisterOf,
  type TPushRegistration,
} from './push-registration'
import { registerPushDevice } from './register-push'

const idle: TPushRegistration = { status: EPushRegistrationStatus.Idle }

export const usePushRegistration = ({ api }: { api: ApiClient | undefined }): TPushRegistration => {
  const [registration, setRegistration] = useState<TPushRegistration>(idle)

  useEffect(() => {
    setRegistration(idle)
    if (api === undefined) return undefined
    let cancelled = false
    let latest: TPushRegistration = idle
    const update = (next: TPushRegistration) => {
      if (cancelled) return
      latest = next
      setRegistration(next)
    }
    const handleRegister = async () => {
      if (!shouldRegisterOf(latest)) return
      update({ status: EPushRegistrationStatus.Registering })
      update(
        await registerPushDevice({
          pushApi: createPushApi({ client: api }),
          clientId: installClientId,
          pushToken: getExpoPushToken,
        }),
      )
    }
    void handleRegister()
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void handleRegister()
    })
    return () => {
      cancelled = true
      subscription.remove()
    }
  }, [api])

  return registration
}
