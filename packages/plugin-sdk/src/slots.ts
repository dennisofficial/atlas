import type { HookChainArgs } from '@dltech/atlas-agent'
import type { TranscriptEntryFold } from '@dltech/atlas-client/transcript'
import type { CommandHandler, ControlCommandHandler } from '@dltech/atlas-commands'
import type {
  EventDraft,
  PluginEventBody,
  PromptFragment,
  RecordBody,
  ToolDefinition,
  V2Event,
} from '@dltech/atlas-core'
import type { AppendHook, ControlPlane } from '@dltech/atlas-control'
import type { CallOp, CallResult, DaemonEventFrame, LiveFrame } from '@dltech/atlas-protocol'

import type { PodCrew } from './crew'
import type { PodMemory } from './memory'
import type { PodSessions } from './sessions'
import type { PodWorktrees } from './worktrees'

export type { PodCrew, SubagentSaid, SubagentSnapshot, SubagentWorktree } from './crew'
export type { PodSessions, SessionBrief, SessionMessage, SpawnedSession } from './sessions'
export { EMPTY_SESSIONS } from './sessions'
export { EMPTY_WORKTREES } from './worktrees'
export type {
  PodWorktrees,
  WorktreeEntryInfo,
  WorktreeListing,
  WorktreeRecord,
  WorktreeRemoval,
  WorktreeState,
  WorktreeUnpushed,
} from './worktrees'
export type {
  MemoryAddress,
  MemoryEntry,
  MemoryKind,
  MemoryScope,
  MemorySnapshot,
  MemorySummary,
  PodMemory,
} from './memory'

export type WebSearchConfig = { backend: string | undefined; key: string | undefined }

export type PodWebSearch = { config(): Promise<WebSearchConfig> }

export type McpServerSource = 'cloud' | 'repo'

export type McpSignInBegin =
  | { ok: true; url: string; expiresAt?: string | undefined }
  | { ok: false; reason: string }

export type PodMcpControl = {
  token(args: { name: string; source: McpServerSource; url: string }): Promise<string | undefined>
  begin(args: { name: string; source: McpServerSource; url: string }): Promise<McpSignInBegin>
}

export const EMPTY_MCP_CONTROL: PodMcpControl = {
  token: async () => undefined,
  begin: async () => ({ ok: false, reason: 'this session cannot start an MCP sign-in' }),
}

export type PodOperatorAsk =
  | { kind: 'input'; prompt: string; secret: boolean }
  | { kind: 'shell'; prompt: string; secret: boolean; shellId: string }

export type PodOperatorOpened = { ok: true; requestId: string } | { ok: false; reason: string }

export type PodOperatorInput = {
  ask(args: { ask: PodOperatorAsk; signal: AbortSignal }): Promise<PodOperatorOpened>
}

export const EMPTY_OPERATOR_INPUT: PodOperatorInput = {
  ask: async () => ({ ok: false, reason: 'this session cannot ask the operator for input' }),
}

export type PodControl = {
  exposePort(args: { port: number }): Promise<{ url: string; tunnelToken: string }>
  memory: PodMemory
  webSearch: PodWebSearch
  mcp: PodMcpControl
  operator: PodOperatorInput
}

export type PluginPodContext = {
  sessionId: string
  workspaceDirectory?: string | null | undefined
  control: PodControl
  crew: PodCrew
  sessions: PodSessions
  worktrees: PodWorktrees
  append(drafts: readonly (EventDraft | RecordBody | PluginEventBody)[]): Promise<void>
  events(): readonly V2Event[]
  call(
    op: CallOp,
    options?: { signal?: AbortSignal; onOutput?(bytes: Uint8Array): void },
  ): Promise<CallResult>
  live(frame: LiveFrame): void
  onDaemonEvent(listener: (frame: DaemonEventFrame) => void): () => void
  log(message: string): void
  env?(): Promise<Record<string, string>>
}

export type PodSlot = {
  childDeny?: readonly string[] | undefined
  tools?(ctx: PluginPodContext): readonly ToolDefinition[]
  hooks?(ctx: PluginPodContext): HookChainArgs
  prompts: readonly PromptFragment[]
  commands: ReadonlyMap<string, CommandHandler<unknown>>
  onDaemonEvent?(frame: DaemonEventFrame): void
}

export type ControlHook = AppendHook

export type ControlSlot = {
  hooks: readonly ControlHook[]
  commands: ReadonlyMap<string, ControlCommandHandler<ControlPlane, unknown>>
}

export type ClientHook = {
  name: string
  appliesTo(event: V2Event): boolean
}

export type ClientSlot = {
  hooks: readonly ClientHook[]
  entryFolds?: readonly TranscriptEntryFold[] | undefined
}

export type PluginTransport = 'none' | 'stream'

const noCrew =
  (what: string): (() => never) =>
  () => {
    throw new Error(`this pod has no ${what}`)
  }

export const EMPTY_CREW: PodCrew = Object.freeze({
  spawn: async () => noCrew('sub-agents')(),
  say: async () => noCrew('sub-agents')(),
  stop: async () => noCrew('sub-agents')(),
  list: () => [],
  report: async () => noCrew('parent to report to')(),
})

export const EMPTY_POD: PodSlot = Object.freeze({ prompts: [], commands: new Map() })

export const EMPTY_CONTROL: ControlSlot = Object.freeze({ hooks: [], commands: new Map() })
