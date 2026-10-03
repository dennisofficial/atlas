import type { ServerWebSocket } from 'bun'

import type { ThreadId } from '@dltech/atlas-core'
import type { RuntimeCheckpoint } from '@dltech/atlas-wire'

import type { StepId } from '@dltech/atlas-harness'
import type { ClientFrame, EClientFrame, RestoreTranscriptParams, ServeFrame } from '@dltech/atlas-harness'
import type { FileBrowser, OperatorInputPort, PendingQueues } from '@dltech/atlas-harness'

import type { FrameBuffer, SignalFrame } from './frame-buffer'
import type { TranscriptReaders } from './requests'
import type { ServeAgentSteer, ServeRoster, ServeRewind } from './serve-app'
import type { ServeLog } from './serve-log'
import type { StepAlias } from './step-alias'
import type { ServeTurnDriver } from './turn-driver'
import type { answerWorkspaceTransfer } from './workspace-ops'

type WorkspaceOps = Pick<Parameters<typeof answerWorkspaceTransfer>[0], 'prepare' | 'apply' | 'activate'>

export type SocketState = { helloed: boolean; alias: StepAlias | null }

export type SessionSocket = ServerWebSocket<SocketState>

export type SessionHandlers = {
  open: (args: { socket: SessionSocket }) => void
  message: (args: { socket: SessionSocket; message: string | Buffer }) => void
  close: (args: { socket: SessionSocket }) => void
  broadcast: (frame: ServeFrame) => void
  broadcastRoster: () => void
  park: (args: { reason: string }) => void
  hangUp: () => void
  clients: () => number
  settling: () => boolean
}

export type HelloFrame = Extract<ClientFrame, { kind: EClientFrame.Hello }>

export type SessionHandlersArgs = {
  threadId: ThreadId
  buffer: FrameBuffer
  inFlight: () => readonly SignalFrame[]
  liveStepId: () => StepId | null
  driver: ServeTurnDriver
  files: Pick<FileBrowser, 'list'>
  refusal: () => string | null
  admissionClosed?: (() => boolean) | undefined
  checkpoint?: (() => RuntimeCheckpoint | null) | undefined
  checkpointChanged?: (() => void) | undefined
  log: ServeLog
  applyUserSettings?: ((content: string) => void) | undefined
  roster?: ServeRoster | undefined
  rewind?: ServeRewind | undefined
  /** The sandbox's own agent registry, narrowed to the operator-steer ops; absent in fakes, which refuse them. */
  agents?: ServeAgentSteer | undefined
  operatorInput?: Pick<OperatorInputPort, 'answer' | 'pending'> | undefined
  /** The operator's queued input; its changes are broadcast and take-back-pending answers from it. Absent in fakes. */
  pending?: PendingQueues | undefined
  /** The transcript stores the read-ops answer from; absent in fakes, which refuse the ops. */
  transcript?: TranscriptReaders | undefined
  /** Re-pins the running loop's model for a set-thread-model op; absent in fakes. */
  selectModel?: ((model: { ref: string; effort: string }) => void) | undefined
  /** Tars the served session directory for the descend's transfer; absent in fakes. */
  sessionArchive?: (() => Promise<Uint8Array | null>) | undefined
  /** Tars the sandbox's memory roots for the descend's memory transfer; absent in fakes. */
  memoryArchive?: (() => Promise<Uint8Array | null>) | undefined
  /** The workspace-transfer ops; absent in fakes, which refuse them. */
  workspace?: WorkspaceOps | undefined
  /** The lift's late transcript restore; absent in fakes, which refuse the op. The marker is the lift's `location-changed` draft, pinned on the restored log. */
  restoreTranscript?:
    | ((marker?: RestoreTranscriptParams['locationChanged']) => Promise<{ restored: boolean; failed: string | null }>)
    | undefined
}
