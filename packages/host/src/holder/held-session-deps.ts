import type { IdPort } from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'
import type { LogPort } from '@dltech/atlas-observability'

import type { HostBus, HostTimers, SessionRuntimeFactory } from './ports'

export type HeldSessionDeps = {
  sessionId: string
  holderId: string
  plane: ControlPlane
  bus: HostBus
  timers: HostTimers
  ids: IdPort
  ttlMs: number
  renewEveryMs: number
  fenceMarginMs: number
  inboxPollMs: number
  idleMinutes: number
  runtimeFor: SessionRuntimeFactory
  log?: LogPort | undefined
}
