import { useSyncExternalStore } from 'react'

import { EPreviewGate } from '@/features/desktop/use-preview-origins'

import { liveKeyOf } from '../../data/preview-browser/live-tabs'
import type { EPreviewWait } from '../../data/preview-browser/preview-wake'

export type VisibleSlot = { threadId: string; tabId: string; element: HTMLElement }

export type FrameRegistry = {
  visible: VisibleSlot | undefined
  opened: ReadonlySet<string>
  loading: ReadonlySet<string>
  gate: EPreviewGate
  waits: Readonly<Record<string, EPreviewWait>>
}

export const EMPTY_REGISTRY: FrameRegistry = {
  visible: undefined,
  opened: new Set(),
  loading: new Set(),
  gate: EPreviewGate.Ready,
  waits: {},
}

export const slotKeyOf = (slot: VisibleSlot): string =>
  liveKeyOf({ threadId: slot.threadId, tabId: slot.tabId })

export function shown(args: { registry: FrameRegistry; slot: VisibleSlot }): FrameRegistry {
  const { registry, slot } = args
  const key = slotKeyOf(slot)
  const opened = registry.opened.has(key) ? registry.opened : new Set([...registry.opened, key])
  return { ...registry, visible: slot, opened }
}

export function hidden(args: { registry: FrameRegistry; element: HTMLElement }): FrameRegistry {
  const { registry, element } = args
  return registry.visible?.element === element ? { ...registry, visible: undefined } : registry
}

export function unloaded(args: { registry: FrameRegistry; key: string }): FrameRegistry {
  const { registry, key } = args
  if (!registry.opened.has(key)) return registry
  const opened = new Set(registry.opened)
  opened.delete(key)
  return { ...registry, opened }
}

export function withLoading(args: {
  registry: FrameRegistry
  key: string
  loading: boolean
}): FrameRegistry {
  const { registry, key, loading } = args
  if (registry.loading.has(key) === loading) return registry
  const next = new Set(registry.loading)
  if (loading) next.add(key)
  else next.delete(key)
  return { ...registry, loading: next }
}

export function withGate(args: { registry: FrameRegistry; gate: EPreviewGate }): FrameRegistry {
  return args.registry.gate === args.gate ? args.registry : { ...args.registry, gate: args.gate }
}

export function withWait(args: {
  registry: FrameRegistry
  threadId: string
  wait: EPreviewWait | undefined
}): FrameRegistry {
  const { registry, threadId, wait } = args
  if (registry.waits[threadId] === wait) return registry
  const waits = { ...registry.waits }
  if (wait === undefined) delete waits[threadId]
  else waits[threadId] = wait
  return { ...registry, waits }
}

let current = EMPTY_REGISTRY
const listeners = new Set<() => void>()

export function changeRegistry(change: (registry: FrameRegistry) => FrameRegistry): void {
  const next = change(current)
  if (next === current) return
  current = next
  for (const listener of listeners) listener()
}

export const resetFrameRegistry = (): void => changeRegistry(() => EMPTY_REGISTRY)

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

export const useFrameRegistry = (): FrameRegistry =>
  useSyncExternalStore(
    subscribe,
    () => current,
    () => EMPTY_REGISTRY,
  )
