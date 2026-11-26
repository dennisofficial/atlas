import { usePostHog } from 'posthog-react-native'
import { useEffect } from 'react'

import { useAuth } from '../auth/auth-provider'
import { pushRegistrationEventOf } from '../push/push-registration'

export const PushRegistrationCapture = () => {
  const posthog = usePostHog()
  const { pushRegistration } = useAuth()

  useEffect(() => {
    const event = pushRegistrationEventOf(pushRegistration)
    if (posthog === undefined || event === undefined) return
    posthog.capture('push_registration', event)
  }, [posthog, pushRegistration])

  return null
}
