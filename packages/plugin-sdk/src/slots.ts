import type { V2Event } from '@dltech/atlas-core'

export type ViewFold<TState = unknown> = {
  name: string
  initial: TState
  fold(state: TState, event: V2Event): TState
}

export type CommandSpec = {
  name: string
  summary: string
}

export type PodHandler = {
  eventType: string
  handle(event: V2Event): Promise<void>
}

export type PodSlot = { handlers: readonly PodHandler[] }

export type ControlHook = {
  name: string
  appliesTo(event: V2Event): boolean
}

export type ControlSlot = { hooks: readonly ControlHook[] }

export type ClientHook = {
  name: string
  appliesTo(event: V2Event): boolean
}

export type ClientSlot = { hooks: readonly ClientHook[] }

export type PluginTransport = 'none' | 'stream'
