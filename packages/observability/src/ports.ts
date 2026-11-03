import type { PortRegistryEntry } from '@dltech/atlas-core'

import type { LogPort } from './log/log.port'
import type { TelemetryPort } from './telemetry/telemetry.port'
import type { TracePort } from './trace/trace.port'

declare module '@dltech/atlas-core' {
  interface PortRegistryEntries {
    readonly TelemetryPort: PortRegistryEntry<TelemetryPort> & { readonly transport: 'none' }
    readonly LogPort: PortRegistryEntry<LogPort> & { readonly transport: 'none' }
    readonly TracePort: PortRegistryEntry<TracePort> & { readonly transport: 'none' }
  }
}
