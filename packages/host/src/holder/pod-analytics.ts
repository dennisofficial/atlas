import type { ThreadId } from '@dltech/atlas-core'
import { EMPTY_ANALYTICS, type PodAnalytics } from '@dltech/atlas-plugin-sdk'

export const analyticsOf = (args: {
  analytics: PodAnalytics | undefined
  sessionId: string
  threadId: ThreadId
}): PodAnalytics => {
  const analytics = args.analytics ?? EMPTY_ANALYTICS
  return {
    capture: ({ event, properties }) =>
      analytics.capture({
        event,
        properties: { ...properties, session_id: args.sessionId, thread_id: args.threadId },
      }),
  }
}
