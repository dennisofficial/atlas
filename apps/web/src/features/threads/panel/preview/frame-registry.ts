import { useSyncExternalStore } from 'react'

import { liveKeyOf } from '../../data/preview-browser/live-tabs'

export type VisibleSlot = { threadId: string; tabId: string; element: HTMLElement }

export type FrameRegistry = {
  visible: VisibleSlot | undefined
  opened: ReadonlySet<string>
  reloads: Readonly<Record<string, number>>
}

export const EMPTY_REGISTRY: FrameRegistry = {
  visible: undefined,
  opened: new Set(),
  reloads: {},
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

export function reloadedFrame(args: { registry: FrameRegistry; key: string }): FrameRegistry {
  const { registry, key } = args
  return { ...registry, reloads: { ...registry.reloads, [key]: (registry.reloads[key] ?? 0) + 1 } }
}

let current = EMPTY_REGISTRY
const listeners = new Set<() => void>()

export function changeRegistry(change: (registry: FrameRegistry) => FrameRegistry): void {
  const next = change(current)
  if (next === current) return
  current = next
  for (const listener of listeners) listener()
}

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
