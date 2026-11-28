import { EPodStart, type DaemonEndpoint } from '@dltech/atlas-pods/sandbox/sandbox-provider'
import type { PodAnalytics } from '@dltech/atlas-plugin-sdk'
import type { ProductAnalytics } from '@dltech/atlas-observability'

export type PodAnalyticsEvent = {
  event: string
  properties: Readonly<Record<string, string | number>>
}

export const podStartedOf = (args: {
  start: EPodStart | undefined
  provider: string
  sessionId: string
  wakeMs: number
  stages?: DaemonEndpoint['stages']
}): PodAnalyticsEvent | undefined => {
  if (args.start === undefined || args.start === EPodStart.Running) return undefined
  return {
    event: 'pod_started',
    properties: {
      reason: args.start,
      provider: args.provider,
      session_id: args.sessionId,
      wake_ms: args.wakeMs,
      ...(args.stages?.instanceStartMs === undefined
        ? {}
        : { instance_start_ms: args.stages.instanceStartMs }),
      ...(args.stages?.daemonReadyMs === undefined
        ? {}
        : { daemon_ready_ms: args.stages.daemonReadyMs }),
    },
  }
}

export const daemonRestartedOf = (args: {
  provider: string
  sessionId: string
}): PodAnalyticsEvent => ({
  event: 'pod_started',
  properties: { reason: 'daemon_restart', provider: args.provider, session_id: args.sessionId },
})

export const podLifecycleCaptureOf = (args: {
  analytics: PodAnalytics | undefined
  provider: string
  sessionId: string
}): {
  woke(report: {
    start: EPodStart | undefined
    wakeMs: number
    stages?: DaemonEndpoint['stages']
  }): void
  greeted(hello: { restart: boolean }): void
} => {
  const capture = (event: PodAnalyticsEvent | undefined): void => {
    if (event !== undefined) args.analytics?.capture(event)
  }
  const { provider, sessionId } = args
  return {
    woke: (report) => capture(podStartedOf({ ...report, provider, sessionId })),
    greeted: ({ restart }) => {
      if (restart) capture(daemonRestartedOf({ provider, sessionId }))
    },
  }
}

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
