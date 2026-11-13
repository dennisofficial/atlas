import type { Attachment, EReportKind, ETldrStatus } from '@dltech/atlas-core'

import { runLabel } from './tools'
import { settled, type ToolRun } from './tool-runs'

export enum EAuthor {
  Operator = 'operator',
  Model = 'model',
}

export enum EEntryKind {
  OperatorSaid = 'operator-said',
  AgentSaid = 'agent-said',
  ModelSaid = 'model-said',
  ModelThought = 'model-thought',
  ToolsRan = 'tools-ran',
  HistoryCompacted = 'history-compacted',
  BackgroundShellEnded = 'background-shell-ended',
  BackgroundShellAwaitingInput = 'background-shell-awaiting-input',
  BackgroundShellMatched = 'background-shell-matched',
  BackgroundShellStillRunning = 'background-shell-still-running',
  ServiceEnded = 'service-ended',
  AgentEnded = 'agent-ended',
  AgentReported = 'agent-reported',
  AgentRestarted = 'agent-restarted',
  TldrWritten = 'tldr-written',
  TurnEnded = 'turn-ended',
  SandboxNotice = 'sandbox-notice',
  Rotated = 'rotated',
  OperatorInput = 'operator-input',
  OperatorRequest = 'operator-request',
  SignIn = 'sign-in',
  SystemContext = 'system-context',
  SystemNotice = 'system-notice',
  PrEvent = 'pr-event',
}

export type OperatorSaidEntry = {
  kind: EEntryKind.OperatorSaid
  author: EAuthor.Operator
  key: string
  text: string
  said: readonly string[]
  steer: boolean
  skills: readonly string[]
  files: readonly string[]
  attachments: readonly Attachment[]
}

export type ModelSaidEntry = {
  kind: EEntryKind.ModelSaid
  author: EAuthor.Model
  key: string
  text: string
  streaming: boolean
  interrupted: boolean
  muted: boolean
}

export type ModelThoughtEntry = {
  kind: EEntryKind.ModelThought
  author: EAuthor.Model
  key: string
  text: string
  streaming: boolean
  heldOpen: boolean
  interrupted: boolean
}

export type ToolsRanEntry = {
  kind: EEntryKind.ToolsRan
  author: EAuthor.Model
  key: string
  text: string
  streaming: boolean
  interrupted: boolean
  run: ToolRun
}

export const toolsRanEntry = (run: ToolRun): ToolsRanEntry => ({
  kind: EEntryKind.ToolsRan,
  author: EAuthor.Model,
  key: run.key,
  text: runLabel(run.calls),
  streaming: run.calls.some((call) => !settled(call)),
  interrupted: false,
  run,
})

export type HistoryCompactedEntry = {
  kind: EEntryKind.HistoryCompacted
  author: EAuthor.Model
  key: string
  text: string
  compactedEntries: number
}

export type BackgroundShellAwaitingInputEntry = {
  kind: EEntryKind.BackgroundShellAwaitingInput
  author: EAuthor.Model
  key: string
  text: string
  shellId: string
  output: string
}

export type BackgroundShellEndedEntry = {
  kind: EEntryKind.BackgroundShellEnded
  author: EAuthor.Model
  key: string
  text: string
  shellId: string
  output: string
  failed: boolean
}

export type BackgroundShellMatchedEntry = {
  kind: EEntryKind.BackgroundShellMatched
  author: EAuthor.Model
  key: string
  text: string
  shellId: string
  output: string
}

export type BackgroundShellStillRunningEntry = {
  kind: EEntryKind.BackgroundShellStillRunning
  author: EAuthor.Model
  key: string
  text: string
  shellId: string
  output: string
}

export type ServiceEndedEntry = {
  kind: EEntryKind.ServiceEnded
  author: EAuthor.Model
  key: string
  text: string
  serviceId: string
  output: string
  failed: boolean
}

export type AgentSaidEntry = {
  kind: EEntryKind.AgentSaid
  author: EAuthor.Model
  key: string
  text: string
  sender: string
  senderSessionId: string | null
}

export type AgentEndedEntry = {
  kind: EEntryKind.AgentEnded
  author: EAuthor.Model
  key: string
  text: string
  agentId: string
  report: string
  failed: boolean
}

export type AgentReportedEntry = {
  kind: EEntryKind.AgentReported
  author: EAuthor.Model
  key: string
  text: string
  agentId: string
  report: string
  reportKind?: EReportKind | undefined
}

export type AgentRestartedEntry = {
  kind: EEntryKind.AgentRestarted
  author: EAuthor.Model
  key: string
  text: string
  agentId: string
}

export type TldrWrittenEntry = {
  kind: EEntryKind.TldrWritten
  author: EAuthor.Model
  key: string
  text: string
  anchorSeq: number
  throughSeq: number
  status?: ETldrStatus | undefined
  streaming?: boolean
}

export type TurnEndedEntry = {
  kind: EEntryKind.TurnEnded
  author: EAuthor.Model
  key: string
  text: string
  durationMs: number
  outputTokens: number
  endedAt: string
  interrupted: boolean
}

export type SandboxNoticeEntry = {
  kind: EEntryKind.SandboxNotice
  author: EAuthor.Model
  key: string
  text: string
  failed: boolean
}

export type RotatedEntry = {
  kind: EEntryKind.Rotated
  author: EAuthor.Model
  key: string
  text: string
  predecessor: string
  handoffPath: string
}

export type OperatorInputEntry = {
  kind: EEntryKind.OperatorInput
  author: EAuthor.Model
  key: string
  text: string
}

export type OperatorRequestState =
  | 'pending'
  | 'delivered'
  | 'cancelled'
  | 'abandoned'
  | 'expired'
  | 'failed'

export type OperatorRequestEntry = {
  kind: EEntryKind.OperatorRequest
  author: EAuthor.Model
  key: string
  text: string
  callId: string
  prompt: string
  shellId?: string | undefined
  state: OperatorRequestState
  path?: string | undefined
  bytes?: number | undefined
  reason?: string | undefined
}

export type SignInEntry = {
  kind: EEntryKind.SignIn
  author: EAuthor.Model
  key: string
  text: string
  subject: string
  url: string
  expiresAt?: string | undefined
  result?: 'connected' | 'failed' | undefined
  reason?: string | undefined
}

export type SystemContextItem = {
  key: string
  label: string
  content: string
  superseded: boolean
}

export type SystemContextEntry = {
  kind: EEntryKind.SystemContext
  author: EAuthor.Model
  key: string
  text: string
  items: readonly SystemContextItem[]
}

export type SystemNoticeEntry = {
  kind: EEntryKind.SystemNotice
  author: EAuthor.Model
  key: string
  text: string
  content: string
}

export type PrEventEntry = {
  kind: EEntryKind.PrEvent
  author: EAuthor.Model
  key: string
  text: string
  body: string
  failed: boolean
  repo: string
  prNumber: number
}

export type TranscriptEntry =
  | OperatorSaidEntry
  | AgentSaidEntry
  | ModelSaidEntry
  | ModelThoughtEntry
  | ToolsRanEntry
  | HistoryCompactedEntry
  | BackgroundShellEndedEntry
  | BackgroundShellAwaitingInputEntry
  | BackgroundShellMatchedEntry
  | BackgroundShellStillRunningEntry
  | ServiceEndedEntry
  | AgentEndedEntry
  | AgentReportedEntry
  | AgentRestartedEntry
  | TldrWrittenEntry
  | TurnEndedEntry
  | SandboxNoticeEntry
  | RotatedEntry
  | OperatorInputEntry
  | OperatorRequestEntry
  | SignInEntry
  | SystemContextEntry
  | SystemNoticeEntry
  | PrEventEntry
