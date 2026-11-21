import { PostHog } from 'posthog-node'

import {
  NullProductAnalytics,
  ProductAnalytics,
  type ProductAnalyticsProperties,
} from '../analytics/product-analytics'
import { NullTracer, type TracePort } from '../trace/trace.port'
import { telemetryEnabled } from '../telemetry/telemetry-policy'
import {
  AGENT_TRACE_SERVICE_NAME,
  LONGEST_TRACED_TURN_MS,
  POSTHOG_HOST,
  POSTHOG_KEY,
} from './posthog-config'
import { PosthogTracer } from './posthog-tracer'

const FLUSH_TIMEOUT_MS = 2000

export class PosthogProductAnalytics extends ProductAnalytics {
  private readonly client: PostHog
  private readonly base: ProductAnalyticsProperties

  constructor(args: { client: PostHog; version: string }) {
    super()
    this.client = args.client
    this.base = { atlas_version: args.version, surface: 'server' }
  }

  capture(args: { userId: string; event: string; properties?: ProductAnalyticsProperties }): void {
    try {
      this.client.capture({
        distinctId: args.userId,
        event: args.event,
        properties: {
          ...args.properties,
          ...this.base,
          $process_person_profile: true,
        },
      })
    } catch {
      // Analytics must never fault a request or a turn.
    }
  }

  async flush(): Promise<void> {
    await this.client.shutdown(FLUSH_TIMEOUT_MS).catch(() => undefined)
  }
}

export const serverTraceOptions = (version: string) => ({
  serviceName: AGENT_TRACE_SERVICE_NAME,
  serviceVersion: version,
  maxSpanAgeMs: LONGEST_TRACED_TURN_MS,
})

export type ServerObservability = {
  readonly analytics: ProductAnalytics
  traceFor(distinctId: string): TracePort
}

/** The v2 server's PostHog client: one queue feeding both product events and turn traces. */
export function serverObservability(args: {
  version: string
  env?: Record<string, string | undefined>
}): ServerObservability {
  if (!telemetryEnabled(args.env ?? process.env)) {
    return { analytics: new NullProductAnalytics(), traceFor: () => new NullTracer() }
  }
  try {
    const client = new PostHog(POSTHOG_KEY, {
      host: POSTHOG_HOST,
      traces: serverTraceOptions(args.version),
    })
    return {
      analytics: new PosthogProductAnalytics({ client, version: args.version }),
      traceFor: (distinctId) => new PosthogTracer({ client, distinctId }),
    }
  } catch {
    return { analytics: new NullProductAnalytics(), traceFor: () => new NullTracer() }
  }
}
