import { PostHogProvider } from 'posthog-react-native'
import type { ReactNode } from 'react'

const apiKey = process.env.EXPO_PUBLIC_POSTHOG_API_KEY
const host = process.env.EXPO_PUBLIC_POSTHOG_HOST

export const AnalyticsProvider = ({ children }: { children: ReactNode }) => {
  if (apiKey === undefined || apiKey.length === 0) return children
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
