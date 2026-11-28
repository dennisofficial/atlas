'use client'

import { useSyncExternalStore } from 'react'

export const RIGHT_PANEL_COLLAPSED_KEY = 'atlas:right-panel-collapsed'

export const RIGHT_PANEL_COLLAPSED_BY_DEFAULT = true

const listeners = new Set<() => void>()
let collapsed = RIGHT_PANEL_COLLAPSED_BY_DEFAULT

function publish(next: boolean) {
  if (collapsed === next) return
  collapsed = next
  for (const listener of listeners) listener()
}

function readStoredCollapsed() {
  try {
    const stored = window.localStorage.getItem(RIGHT_PANEL_COLLAPSED_KEY)
    publish(stored === null ? RIGHT_PANEL_COLLAPSED_BY_DEFAULT : stored === 'true')
  } catch {}
}

function handleStorage(event: StorageEvent) {
  if (event.key === RIGHT_PANEL_COLLAPSED_KEY || event.key === null) readStoredCollapsed()
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) {
    readStoredCollapsed()
    window.addEventListener('storage', handleStorage)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) window.removeEventListener('storage', handleStorage)
  }
}

function setCollapsed(next: boolean) {
  publish(next)
  try {
    window.localStorage.setItem(RIGHT_PANEL_COLLAPSED_KEY, String(next))
  } catch {}
}

const snapshot = () => collapsed
const serverSnapshot = () => RIGHT_PANEL_COLLAPSED_BY_DEFAULT

export function useRightPanelCollapsed() {
  return { collapsed: useSyncExternalStore(subscribe, snapshot, serverSnapshot), setCollapsed }
}
