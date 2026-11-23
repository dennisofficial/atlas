import type { CommandRegistry } from '@dltech/atlas-commands'
import type { PodMcpControl } from '@dltech/atlas-plugin-sdk'
import type { IdPort } from '@dltech/atlas-core'
import type { ChangeContentStore, ContextContentStore, ControlPlane } from '@dltech/atlas-control'
import type { LogPort } from '@dltech/atlas-observability'

import type { HostBus, HostPresence, HostTimers, PodPeers, SessionRuntimeFactory } from './ports'
import type { ParkArchivedPod } from './park-archived'
import type { PodControlClient } from './pod-control'
import type { CommandHandlers, ControlHandlers } from './command-intake'
import type { NotifyDispatch } from './notify-dispatch'
import type { PanelDemand } from './panel-demand'
import type { PodCallBus } from './pod-call-port'
import type { TerminalDemand } from './terminal-demand'
import type { TurnEndedHook } from './turn-ended-hook'
import { DEFAULT_APPEND_RETRY_MS } from './record/retry-deadline'

export type SessionHolderArgs = {
  presence: HostPresence
  plane: ControlPlane
  bus: HostBus
  timers: HostTimers
  runtimes: SessionRuntimeFactory
  ids: IdPort
  podPeers?: PodPeers | undefined
  appendRetryMs?: number | undefined
  sweepMs?: number | undefined
  isPermanentStartError?: ((error: unknown) => boolean) | undefined
  reasonOfStartError?: ((error: unknown) => string) | undefined
  commands?: CommandRegistry | undefined
  commandHandlers?: CommandHandlers | undefined
  controlHandlers?: ControlHandlers | undefined
  control?: PodControlClient | undefined
  mcp?: ((sessionId: string) => PodMcpControl) | undefined
  operator?:
    | {
        sessionDir: (sessionId: string) => string
        openValue: (sealed: string) => string
      }
    | undefined
  changes?: { content: ChangeContentStore } | undefined
  contextMirror?:
    | { content: ContextContentStore; contextDir: (sessionId: string) => string }
    | undefined
  notify?: NotifyDispatch | undefined
  parkArchived?: ParkArchivedPod | undefined
  turnEnded?: TurnEndedHook | undefined
  log?: LogPort | undefined
  onHostIdChanged?: (() => void) | undefined
  terminalDemand?: TerminalDemand | undefined
  panelDemand?: PanelDemand | undefined
  podCallBus?: PodCallBus | undefined
}

export const SESSION_HOLDER_DEFAULTS = {
  appendRetryMs: DEFAULT_APPEND_RETRY_MS,
  sweepMs: 20_000,
} as const
