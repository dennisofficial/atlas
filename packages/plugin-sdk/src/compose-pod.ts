import type { HookChainArgs } from '@dltech/atlas-agent'
import type { CommandHandler } from '@dltech/atlas-commands'
import type { PromptFragment, ToolDefinition } from '@dltech/atlas-core'
import type { DaemonEventFrame } from '@dltech/atlas-protocol'

import type { PluginPodContext, PodSlot } from './slots'

export type ComposedPod = {
  childDeny: readonly string[]
  tools(ctx: PluginPodContext): readonly ToolDefinition[]
  hooks(ctx: PluginPodContext): HookChainArgs
  prompts: readonly PromptFragment[]
  commands: ReadonlyMap<string, CommandHandler<unknown>>
  onDaemonEvent(frame: DaemonEventFrame): void
}

const concat = <T>(lists: readonly (readonly T[] | undefined)[]): T[] =>
  lists.flatMap((list) => list ?? [])

export const mergeHooks = (sets: readonly HookChainArgs[]): HookChainArgs => ({
  beforeTurn: concat(sets.map((set) => set.beforeTurn)),
  beforeStep: concat(sets.map((set) => set.beforeStep)),
  beforeRequest: concat(sets.map((set) => set.beforeRequest)),
  beforeTool: concat(sets.map((set) => set.beforeTool)),
  afterTool: concat(sets.map((set) => set.afterTool)),
  afterShell: concat(sets.map((set) => set.afterShell)),
  onChunk: concat(sets.map((set) => set.onChunk)),
  afterTurn: concat(sets.map((set) => set.afterTurn)),
  onThreadOpen: concat(sets.map((set) => set.onThreadOpen)),
})

export const uniqueBy = <T>(args: {
  items: readonly T[]
  keyOf(item: T): string
  what: string
}): T[] => {
  const seen = new Set<string>()
  for (const item of args.items) {
    const key = args.keyOf(item)
    if (seen.has(key)) throw new Error(`two plugins register ${args.what} "${key}"`)
    seen.add(key)
  }
  return [...args.items]
}

export const mergeMaps = <V>(args: {
  maps: readonly ReadonlyMap<string, V>[]
  what: string
}): ReadonlyMap<string, V> => {
  const merged = new Map<string, V>()
  for (const map of args.maps) {
    for (const [key, value] of map) {
      if (merged.has(key)) throw new Error(`two plugins register ${args.what} "${key}"`)
      merged.set(key, value)
    }
  }
  return merged
}

export const composePod = (pods: readonly PodSlot[]): ComposedPod => {
  const prompts = Object.freeze(
    uniqueBy({
      items: pods.flatMap((pod) => pod.prompts),
      keyOf: (fragment) => fragment.id,
      what: 'the prompt fragment',
    }),
  )
  const commands = mergeMaps({ maps: pods.map((pod) => pod.commands), what: 'the pod command' })
  const childDeny = Object.freeze([...new Set(pods.flatMap((pod) => pod.childDeny ?? []))])
  return Object.freeze({
    prompts,
    commands,
    childDeny,
    tools: (ctx) =>
      uniqueBy({
        items: pods.flatMap((pod) => pod.tools?.(ctx) ?? []),
        keyOf: (tool) => tool.name,
        what: 'the tool',
      }),
    hooks: (ctx) => mergeHooks(pods.map((pod) => pod.hooks?.(ctx) ?? {})),
    onDaemonEvent: (frame) => {
      for (const pod of pods) pod.onDaemonEvent?.(frame)
    },
  })
}
