import { NullTelemetry } from './telemetry/null-telemetry'
import type { TelemetryPort } from './telemetry/telemetry.port'
import { NullTracer, type TracePort } from './trace/trace.port'

export type Observability = {
  readonly telemetry: TelemetryPort
  readonly trace: TracePort
}

export const nullObservability = (): Observability => ({
  telemetry: new NullTelemetry(),
  trace: new NullTracer(),
})
