import type { HookChainArgs } from '@dltech/atlas-agent'
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
import type { CallOp, CallResult, DaemonEventFrame } from '@dltech/atlas-protocol'

export type PluginPodContext = {
  sessionId: string
  append(drafts: readonly (EventDraft | RecordBody | PluginEventBody)[]): Promise<void>
  events(): readonly V2Event[]
  call(
    op: CallOp,
    options?: { signal?: AbortSignal; onOutput?(bytes: Uint8Array): void },
  ): Promise<CallResult>
  onDaemonEvent(listener: (frame: DaemonEventFrame) => void): () => void
  log(message: string): void
}

export type PodSlot = {
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

export type ClientSlot = { hooks: readonly ClientHook[] }

export type PluginTransport = 'none' | 'stream'

export const EMPTY_POD: PodSlot = Object.freeze({ prompts: [], commands: new Map() })

export const EMPTY_CONTROL: ControlSlot = Object.freeze({ hooks: [], commands: new Map() })
