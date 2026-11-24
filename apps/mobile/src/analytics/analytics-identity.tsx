import { usePostHog } from 'posthog-react-native'
import { useEffect, useRef } from 'react'

import { useAuth } from '../auth/auth-provider'
import { EIdentityAction, identityStepOf } from './identity-action'

export const AnalyticsIdentity = () => {
  const posthog = usePostHog()
  const { state, user } = useAuth()
  const identifiedId = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (posthog === undefined) return
    const step = identityStepOf({ identifiedId: identifiedId.current, state, user })
    if (step.action === EIdentityAction.Identify) {
      posthog.identify(step.userId, { email: step.email })
      identifiedId.current = step.userId
      return
    }
    if (step.action === EIdentityAction.Reset) {
      posthog.reset()
      identifiedId.current = undefined
    }
  }, [posthog, state, user])

  return null
}
