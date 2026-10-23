import type { ServerWebSocket } from 'bun'

import type { ThreadId } from '@dltech/atlas-core'
import type { RuntimeCheckpoint } from '@dltech/atlas-wire'

import type { StepId } from '@dltech/atlas-harness'
import type { ClientFrame, EClientFrame, ServeFrame } from '@dltech/atlas-harness'
import type { FileBrowser, OperatorInputPort, PendingQueues } from '@dltech/atlas-harness'

import type { ContextReaders } from './context-requests'
import type { MentionRouting } from './mention-requests'
import type { FrameBuffer, SignalFrame } from './frame-buffer'
import type { TranscriptReaders } from './requests'
import type { ServeAgentSteer, ServePrStates, ServeRoster, ServeRewind } from './serve-app'
import type { ServeLog } from './serve-log'
import type { ThreadModelPersister } from './serve-thread-model-persist'
import type { StepAlias } from './step-alias'
import type { ServeTurnDriver } from './turn-driver'

export type SocketState = {
  helloed: boolean
  alias: StepAlias | null
  greeting: number
  greeted: boolean
  /** Decoded frames the greeter holds until the socket is greeted. */
  held: ClientFrame[]
  /** Raw frames buffered while the socket is held across a still-running boot. */
  bootHeld: string[]
}

export type SessionSocket = ServerWebSocket<SocketState>

export type SessionHandlers = {
  open: (args: { socket: SessionSocket }) => void
  message: (args: { socket: SessionSocket; message: string | Buffer }) => void
  close: (args: { socket: SessionSocket }) => void
  broadcast: (frame: ServeFrame) => void
  replayDeferred: () => void
  broadcastRoster: () => void
  broadcastPrStates: () => void
  park: (args: { reason: string }) => void
  hangUp: () => void
  abortHistory: () => void
  clients: () => number
  settling: () => boolean
  whenSettled: () => Promise<void>
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
  /** The github plugin's live PR readings; absent in fakes, which answer empty. */
  prStates?: ServePrStates | undefined
  rewind?: ServeRewind | undefined
  compaction?: import('@dltech/atlas-harness').CompactionPort | undefined
  rotation?: import('@dltech/atlas-harness').RotationPort | undefined
  /** The sandbox's own agent registry, narrowed to the operator-steer ops; absent in fakes, which refuse them. */
  agents?: ServeAgentSteer | undefined
  operatorInput?: Pick<OperatorInputPort, 'answer' | 'pending'> | undefined
  /** The operator's queued input; its changes are broadcast and take-back-pending answers from it. Absent in fakes. */
  pending?: PendingQueues | undefined
  context?: ContextReaders | undefined
  /** Answers the @-mention ops from the owning filesystem; absent in fakes, which refuse them. */
  mentions?: MentionRouting | undefined
  /** The transcript stores the read-ops answer from; absent in fakes, which refuse the ops. */
  transcript?: TranscriptReaders | undefined
  /** Re-pins the running loop's model for a set-thread-model op; absent in fakes. */
  selectModel?: ((model: { ref: string; effort: string }) => void) | undefined
  persistModel?: ThreadModelPersister | undefined
  /** The session-directory mirror's read surface; absent in fakes, which refuse the ops. */
}
