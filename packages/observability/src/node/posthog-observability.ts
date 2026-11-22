import { PostHog } from 'posthog-node'

import { nullObservability, type Observability } from '../observability'
import {
  deployCommitOf,
  LONGEST_TRACED_TURN_MS,
  POSTHOG_HOST,
  POSTHOG_KEY,
  TRACE_SERVICE_NAME,
} from './posthog-config'
import { PosthogTelemetry } from './posthog-telemetry'
import { PosthogTracer } from './posthog-tracer'

export function posthogObservability(args: {
  distinctId: string
  version: string
  env?: Record<string, string | undefined> | undefined
}): Observability {
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
      trace: new PosthogTracer({
        client,
        distinctId: args.distinctId,
        deployCommit: deployCommitOf(args.env ?? process.env),
      }),
    }
  } catch {
    return nullObservability()
  }
}
