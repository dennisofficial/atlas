import type { HookChainArgs } from '@dltech/atlas-agent'
import type { TranscriptEntryFold } from '@dltech/atlas-client/transcript'
import type { CommandHandler, ControlCommandHandler } from '@dltech/atlas-commands'
import { EClassifierFault } from '@dltech/atlas-core'
import type {
  ClassifierOutcome,
  ClassifierQuestion,
  ClassifierStatus,
  EventBody,
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
import { MacOfflineError, type PodMcpProxyChannel, type PodMcpProxyTransport } from './mcp-proxy'
import type { PodMemory } from './memory'
import type { PodMessages } from './messages'
import type { ECloudSetting, PodResource, PodResources } from './resources'
import type { PodRoutines } from './routines'
import type { PodSessions } from './sessions'
import type { PodSubscriptions } from './subscriptions'
import type { PodWorktrees } from './worktrees'

export type { PodCrew, SubagentSaid, SubagentSnapshot, SubagentWorktree } from './crew'
export type { PodSessions, SessionBrief, SpawnedSession } from './sessions'
export type { SpawnFile } from '@dltech/atlas-core'
export { EMPTY_SESSIONS } from './sessions'
export { EMPTY_MESSAGES, PARENT_ADDRESS } from './messages'
export type { MessageSent, PodMessages } from './messages'
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
export { EMPTY_ROUTINES } from './routines'
export type { PodRoutineInput, PodRoutines } from './routines'
export { EMPTY_SUBSCRIPTIONS } from './subscriptions'
export type {
  PodSubscribeArgs,
  PodSubscriptionLease,
  PodSubscriptions,
} from './subscriptions'
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

export type PodGateway = { apiKey(): Promise<string | undefined> }

export type McpServerSource = 'cloud' | 'repo'

export type McpSignInBegin =
  | { ok: true; url: string; expiresAt?: string | undefined }
  | { ok: false; reason: string }

export type PodMcpControl = {
  token(args: { name: string; source: McpServerSource; url: string }): Promise<string | undefined>
  begin(args: { name: string; source: McpServerSource; url: string }): Promise<McpSignInBegin>
  proxy(args: {
    name: string
    transport: PodMcpProxyTransport
    waitMs: number
  }): Promise<PodMcpProxyChannel>
}

export const EMPTY_MCP_CONTROL: PodMcpControl = {
  token: async () => undefined,
  begin: async () => ({ ok: false, reason: 'this session cannot start an MCP sign-in' }),
  proxy: async () => {
    throw new MacOfflineError()
  },
}

export type PodControl = {
  exposePort(args: { port: number }): Promise<{ url: string; tunnelToken: string }>
  settingsVersions(): Promise<Readonly<Record<ECloudSetting, string>>>
  memory: PodMemory
  webSearch: PodWebSearch
  gateway: PodGateway
  mcp: PodMcpControl
  routines: PodRoutines
  subscriptions: PodSubscriptions
}

export const EMPTY_GATEWAY: PodGateway = Object.freeze({ apiKey: async () => undefined })

export type PodClassifierStatus = ClassifierStatus

export type PodClassifier = {
  status(): PodClassifierStatus
  classify(args: {
    state: string
    questions: Record<string, ClassifierQuestion>
    signal: AbortSignal
  }): Promise<ClassifierOutcome>
}

export const EMPTY_CLASSIFIER: PodClassifier = Object.freeze({
  status: (): PodClassifierStatus => ({ on: false, reason: 'no classifier' }),
  classify: async (): Promise<ClassifierOutcome> => ({
    ok: false,
    fault: EClassifierFault.Unavailable,
    detail: 'this pod has no classifier',
  }),
})

export type PluginPodContext = {
  sessionId: string
  workspaceDirectory?: string | null | undefined
  control: PodControl
  crew: PodCrew
  messages: PodMessages
  classifier: PodClassifier
  sessions: PodSessions
  worktrees: PodWorktrees
  resources: PodResources
  append(drafts: readonly (EventDraft | RecordBody | PluginEventBody)[]): Promise<void>
  /** Delivers a turn-taking notice through the agent's queue. */
  notify(event: EventBody, options: { key: string }): Promise<void>
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

export type SlashLoadResult =
  | { ok: true; drafts: readonly EventDraft[] }
  | { ok: false; reason: string }

export type PodSlash = {
  names(): Promise<readonly string[]>
  load(input: { name: string; argumentText: string }): Promise<SlashLoadResult>
}

export type PodSlot = {
  childDeny?: readonly string[] | undefined
  tools?(ctx: PluginPodContext): readonly ToolDefinition[]
  hooks?(ctx: PluginPodContext): HookChainArgs
  prompts: readonly PromptFragment[]
  commands: ReadonlyMap<string, CommandHandler<unknown>>
  resources?: readonly PodResource<unknown>[] | undefined
  slash?: ((ctx: PluginPodContext) => PodSlash) | undefined
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
