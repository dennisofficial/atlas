import { PostHogProvider } from 'posthog-react-native'
import type { ReactNode } from 'react'

import { analyticsEnabledOf } from './analytics-enabled'

const apiKey = process.env.EXPO_PUBLIC_POSTHOG_API_KEY
const host = process.env.EXPO_PUBLIC_POSTHOG_HOST

export const analyticsEnabled = analyticsEnabledOf({ apiKey })

export const AnalyticsProvider = ({ children }: { children: ReactNode }) => {
  if (!analyticsEnabled || apiKey === undefined) return children
  return (
    <PostHogProvider
      apiKey={apiKey}
      autocapture={{ captureScreens: false, captureTouches: false }}
      options={{
        host,
        enableSessionReplay: false,
        errorTracking: {
          autocapture: { uncaughtExceptions: true, unhandledRejections: true },
        },
      }}
    >
      {children}
    </PostHogProvider>
  )
}
