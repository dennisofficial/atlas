import type { PortRegistryEntry } from '@dltech/atlas-core'

import type { LogPort } from './log/log.port'
import type { TelemetryPort } from './telemetry/telemetry.port'

declare module '@dltech/atlas-core' {
  interface PortRegistryEntries {
    readonly TelemetryPort: PortRegistryEntry<TelemetryPort> & { readonly transport: 'none' }
    readonly LogPort: PortRegistryEntry<LogPort> & { readonly transport: 'none' }
  }
}
