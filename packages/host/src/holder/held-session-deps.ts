import type { CommandRegistry } from '@dltech/atlas-commands'
import type { IdPort } from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'
import type { LogPort } from '@dltech/atlas-observability'
import type { PodMcpControl } from '@dltech/atlas-plugin-sdk'

import type { CommandHandlers } from './command-intake'
import type { AwaitingOperator, OperatorRequestPort } from './operator-requests'
import type { PodControlClient } from './pod-control'
import type { HostBus, HostTimers, PodPeers, SessionRuntimeFactory } from './ports'

export type StartVerdict = { permanent: boolean; giveUp: boolean }

export type HeldSessionDeps = {
  sessionId: string
  podSessionId: string
  podPeers?: PodPeers | undefined
  plane: ControlPlane
  bus: HostBus
  timers: HostTimers
  ids: IdPort
  appendRetryMs: number
  idleMinutes: number
  stallAfterMs?: number | undefined
  runtimeFor: SessionRuntimeFactory
  judgeStartFailure?: ((error: unknown) => StartVerdict) | undefined
  reasonOfStartError?: ((error: unknown) => string) | undefined
  commands?: CommandRegistry | undefined
  commandHandlers?: CommandHandlers | undefined
  control?: PodControlClient | undefined
  mcp?: ((sessionId: string) => PodMcpControl) | undefined
  operator?: ((sessionId: string) => OperatorRequestPort) | undefined
  awaitingOperator?: AwaitingOperator | undefined
  sessionDir: string
  log?: LogPort | undefined
}
