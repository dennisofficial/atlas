import type { PodAnalytics } from '@dltech/atlas-plugin-sdk'
import type { ProductAnalytics } from '@dltech/atlas-observability'

export const podAnalyticsOf = (args: {
  analytics: ProductAnalytics | undefined
  userId: string
}): PodAnalytics | undefined => {
  const analytics = args.analytics
  if (analytics === undefined) return undefined
  return {
    capture: ({ event, properties }) => {
      try {
        analytics.capture({ userId: args.userId, event, properties })
      } catch {}
    },
  }
}
