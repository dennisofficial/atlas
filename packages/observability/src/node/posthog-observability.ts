import { PostHog } from 'posthog-node'

import { nullObservability, type Observability } from '../observability'
import { PosthogTelemetry } from './posthog-telemetry'
import { PosthogTracer } from './posthog-tracer'

const POSTHOG_KEY = 'phc_q27hvgM8kSbwyjca72m3v7QexFE25FfFG8n529zM2WqL'
const POSTHOG_HOST = 'https://us.i.posthog.com'
const TRACE_SERVICE_NAME = 'atlas'
const LONGEST_TRACED_TURN_MS = 24 * 60 * 60 * 1000

export function posthogObservability(args: { distinctId: string; version: string }): Observability {
  try {
    const client = new PostHog(POSTHOG_KEY, {
      host: POSTHOG_HOST,
      traces: {
        serviceName: TRACE_SERVICE_NAME,
        serviceVersion: args.version,
        maxSpanAgeMs: LONGEST_TRACED_TURN_MS,
      },
    })
    return {
      telemetry: new PosthogTelemetry({
        client,
        distinctId: args.distinctId,
        version: args.version,
      }),
      trace: new PosthogTracer({ client, distinctId: args.distinctId }),
    }
  } catch {
    return nullObservability()
  }
}
