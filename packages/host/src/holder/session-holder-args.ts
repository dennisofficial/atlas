import type { CommandRegistry } from '@dltech/atlas-commands'
import type { PodMcpControl } from '@dltech/atlas-plugin-sdk'
import type { IdPort } from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'
import type { LogPort } from '@dltech/atlas-observability'

import type { HostBus, HostPresence, HostTimers, PodPeers, SessionRuntimeFactory } from './ports'
import type { PodControlClient } from './pod-control'
import type { CommandHandlers } from './command-intake'
import { DEFAULT_APPEND_RETRY_MS } from './record/retry-deadline'

export type SessionHolderArgs = {
  presence: HostPresence
  plane: ControlPlane
  bus: HostBus
  timers: HostTimers
  runtimes: SessionRuntimeFactory
  ids: IdPort
  podPeers?: PodPeers | undefined
  maxSessions: number
  appendRetryMs?: number | undefined
  idleMinutes?: number | undefined
  sweepMs?: number | undefined
  isPermanentStartError?: ((error: unknown) => boolean) | undefined
  reasonOfStartError?: ((error: unknown) => string) | undefined
  commands?: CommandRegistry | undefined
  commandHandlers?: CommandHandlers | undefined
  control?: PodControlClient | undefined
  mcp?: ((sessionId: string) => PodMcpControl) | undefined
  operator?:
    | {
        sessionDir: (sessionId: string) => string
        openValue: (sealed: string) => string
      }
    | undefined
  log?: LogPort | undefined
  onHostIdChanged?: (() => void) | undefined
}

export const SESSION_HOLDER_DEFAULTS = {
  appendRetryMs: DEFAULT_APPEND_RETRY_MS,
  idleMinutes: 30,
  sweepMs: 20_000,
} as const
