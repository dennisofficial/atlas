import type { IdPort } from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'
import type { LogPort } from '@dltech/atlas-observability'

import type { HostBus, HostTimers, SessionRuntimeFactory } from './ports'

export type HeldSessionDeps = {
  sessionId: string
  plane: ControlPlane
  bus: HostBus
  timers: HostTimers
  ids: IdPort
  appendRetryMs: number
  idleMinutes: number
  runtimeFor: SessionRuntimeFactory
  onDrop?: (() => void) | undefined
  onAppendExhausted?: (() => void) | undefined
  log?: LogPort | undefined
}
