import type { HookChainArgs } from '@dltech/atlas-agent'
import type { CommandHandler } from '@dltech/atlas-commands'
import type { PromptFragment, ToolDefinition } from '@dltech/atlas-core'
import type { DaemonEventFrame } from '@dltech/atlas-protocol'

import type { PodResource } from './resources'
import type { DaemonReady, PluginPodContext, PodCommandFactory, PodSlash, PodSlot } from './slots'

export type ComposedPod = {
  childDeny: readonly string[]
  tools(ctx: PluginPodContext): readonly ToolDefinition[]
  hooks(ctx: PluginPodContext): HookChainArgs
  prompts: readonly PromptFragment[]
  commands(ctx: PluginPodContext): ReadonlyMap<string, CommandHandler<unknown>>
  resources: readonly PodResource<unknown>[]
  slash(ctx: PluginPodContext): PodSlash | undefined
  onDaemonEvent(frame: DaemonEventFrame): void
  onDaemonReady(args: { ctx: PluginPodContext; hello: DaemonReady }): void
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
  const slashes = pods.flatMap((pod) => (pod.slash === undefined ? [] : [pod.slash]))
  if (slashes.length > 1) throw new Error('two plugins register a slash source')
  const slash = slashes[0]
  const childDeny = Object.freeze([...new Set(pods.flatMap((pod) => pod.childDeny ?? []))])
  const resources = Object.freeze(
    uniqueBy({
      items: concat(pods.map((pod) => pod.resources)),
      keyOf: (resource) => resource.name,
      what: 'the resource',
    }),
  )
  return Object.freeze({
    prompts,
    childDeny,
    resources,
    tools: (ctx) =>
      uniqueBy({
        items: pods.flatMap((pod) => pod.tools?.(ctx) ?? []),
        keyOf: (tool) => tool.name,
        what: 'the tool',
      }),
    hooks: (ctx) => mergeHooks(pods.map((pod) => pod.hooks?.(ctx) ?? {})),
    commands: (ctx) =>
      mergeMaps({
        maps: pods.map((pod) => pod.commands?.(ctx) ?? new Map()),
        what: 'the pod command',
      }),
    slash: (ctx) => slash?.(ctx),
    onDaemonEvent: (frame) => {
      for (const pod of pods) pod.onDaemonEvent?.(frame)
    },
    onDaemonReady: (ready) => {
      for (const pod of pods) pod.onDaemonReady?.(ready)
    },
  })
}

export const composePodCommands = (args: {
  factories: readonly PodCommandFactory[]
  ctx?: PluginPodContext | undefined
}): ReadonlyMap<string, CommandHandler<unknown>> => {
  const { ctx } = args
  if (ctx === undefined) return new Map()
  return mergeMaps({
    maps: args.factories.map((factory) => factory(ctx)),
    what: 'the pod command',
  })
}
