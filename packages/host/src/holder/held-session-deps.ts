import type { CommandRegistry } from '@dltech/atlas-commands'
import type { IdPort } from '@dltech/atlas-core'
import type { ChangeContentStore, ContextContentStore, ControlPlane } from '@dltech/atlas-control'
import type { LogPort } from '@dltech/atlas-observability'
import type { PodMcpControl, PodCommandFactory } from '@dltech/atlas-plugin-sdk'

import type { CommandHandlers, ControlHandlers } from './command-intake'
import type { NotifyDispatch } from './notify-dispatch'
import type { ParkArchivedPod } from './park-archived'
import type { PodControlClient } from './pod-control'
import type { TurnEndedHook } from './turn-ended-hook'
import type { HostBus, HostTimers, PodPeers, SessionRuntimeFactory } from './ports'
import type { RecordResumeCache } from './record/record-resume'

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
  drainCapMs: number
  runtimeFor: SessionRuntimeFactory
  judgeStartFailure?: ((error: unknown) => StartVerdict) | undefined
  reasonOfStartError?: ((error: unknown) => string) | undefined
  commands?: CommandRegistry | undefined
  commandHandlers?: CommandHandlers | undefined
  podCommands?: readonly PodCommandFactory[] | undefined
  controlHandlers?: ControlHandlers | undefined
  control?: PodControlClient | undefined
  mcp?: ((sessionId: string) => PodMcpControl) | undefined
  operator?: { sessionDir: string; openValue: (sealed: string) => string } | undefined
  changes?: { content: ChangeContentStore } | undefined
  contextMirror?:
    | { content: ContextContentStore; contextDir: (sessionId: string) => string }
    | undefined
  notify?: NotifyDispatch | undefined
  parkArchived?: ParkArchivedPod | undefined
  turnEnded?: TurnEndedHook | undefined
  recordResume?: RecordResumeCache | undefined
  onRuntimeReady?: (() => void) | undefined
  log?: LogPort | undefined
}
