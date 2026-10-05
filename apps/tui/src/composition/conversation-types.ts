import type {
  ActiveWorktree,
  ECompactionAnchor,
  EExecutionLocation,
  Event,
  EventDraft,
  SaidFile,
  SaidImage,
  ThreadId,
} from '@dltech/atlas-core'
import type {
  ECompactScope,
  LostShell,
  RecoveredAgents,
  ThreadModel,
  ThreadStorePort,
} from '@dltech/atlas-harness'

import type {
  EThinkingVisibility,
  PendingRow,
  PendingSaid,
  SidebarModel,
  TranscriptModel,
} from '../store'
import type { Compacting } from '../ui/components/compacting'

import type { OperatorInputControl } from './use-operator-input'
import type { TurnClock } from '../ui/turn-clock'
import type { QueuedSettled } from './commands'
import type { CommandEffect } from './commands/local-command'
import type { AtlasApp } from './compose'
import type { OpenedConversation } from './open-conversation'
import type { Renaming } from './session-rename'
import type { RewindConfirmControl } from './use-rewind-confirm'
import type { NamingRequest } from './use-session-name'

export type SendArgs = {
  text: string
  images?: readonly SaidImage[] | undefined
  files?: readonly SaidFile[] | undefined
  context?: readonly EventDraft[] | undefined
}

export type ConversationArgs = {
  app: AtlasApp
  threads?: ThreadStorePort | undefined
  opened: OpenedConversation
  paceReveal: boolean
  thinking: EThinkingVisibility
  tldrStatus: boolean
  onUndone: (said: PendingSaid) => void
  canWake: boolean
  interruptRefusal?: (() => string | null) | undefined
  driveRefusal?: (() => string | null) | undefined
  onLocalOpened?: ((opened: OpenedConversation) => void) | undefined
  /** False while the cloud channel is closed or reattaching — a retry or resume can only re-fail. */
  channelReady?: boolean | undefined
  frozen?: boolean
}

export type ConversationWorkspace = {
  projectDirectory: string
  activeWorktree: ActiveWorktree | null
  repo: string | null
}

export type Conversation = {
  threadId: ThreadId
  started: boolean
  threadModel: ThreadModel | undefined
  executionLocation: EExecutionLocation | undefined
  attachPending: boolean
  rewindConfirm: RewindConfirmControl
  lost: RecoveredAgents | null
  lostShells: readonly LostShell[]
  handle: string | null
  sessionName: string | null
  naming: boolean
  namingRequest: NamingRequest | null
  model: TranscriptModel
  sidebar: SidebarModel
  turn: TurnClock
  now: number
  working: boolean
  turnInFlight: () => boolean
  mutations: number
  contextTokens: number
  projectDirectory: string
  activeWorktree: ActiveWorktree | null
  repo: string | null
  pending: readonly PendingRow[]
  operatorInput: OperatorInputControl
  readEvents: () => Promise<readonly Event[]>
  loadOlderHistory: () => Promise<void>
  hasOlderHistory: boolean
  refresh: () => Promise<void>
  handleSend: (args: SendArgs) => void
  handleQueueSettled: (entry: QueuedSettled) => void
  /** Local sessions answer synchronously; a cloud session asks the sandbox, so it answers async. */
  handleTakeBackPending: () => PendingSaid | null | Promise<PendingSaid | null>
  handleRetry: (() => void) | null
  handleDismissFailure: (() => void) | null
  handleResume: (() => void) | null
  handleReportProblem: (reason: string) => void
  handleInterrupt: () => void
  handleInterruptForMove: () => void
  handlePauseForMove: () => void
  handleResumeSource: () => void
  whenSettled: () => Promise<void>
  compacting: Compacting | null
  handleNewConversation: () => void
  handleOpenThread: (threadId: string) => void
  handleChangeDirectory: (argumentText: string) => Promise<CommandEffect>
  handleRename: (argumentText: string) => Promise<Renaming>
  handleCompact: (scope: ECompactScope) => void
  handleCompactAround: (args: { anchor: ECompactionAnchor; seq: number }) => void
  handleRewindTo: (toSeq: number) => void
  handleRevokeGrant: (grantId: string) => void
}
