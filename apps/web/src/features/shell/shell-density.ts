'use client'

import { useSyncExternalStore } from 'react'

export enum ESidebarDensity {
  Comfortable = 'comfortable',
  Compact = 'compact',
}

const STORAGE_KEY = 'atlas:sidebar-density'
const listeners = new Set<() => void>()
let density = ESidebarDensity.Comfortable

function publish(next: ESidebarDensity) {
  if (density === next) return
  density = next
  for (const listener of listeners) listener()
}

function readStoredDensity() {
  try {
    publish(
      window.localStorage.getItem(STORAGE_KEY) === ESidebarDensity.Compact
        ? ESidebarDensity.Compact
        : ESidebarDensity.Comfortable,
    )
  } catch {}
}

function handleStorage(event: StorageEvent) {
  if (event.key === STORAGE_KEY || event.key === null) readStoredDensity()
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) {
    readStoredDensity()
    window.addEventListener('storage', handleStorage)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) window.removeEventListener('storage', handleStorage)
  }
}

function setDensity(next: ESidebarDensity) {
  publish(next)
  try {
    window.localStorage.setItem(STORAGE_KEY, next)
  } catch {}
}

const snapshot = () => density
const serverSnapshot = () => ESidebarDensity.Comfortable

export function useSidebarDensity() {
  return { density: useSyncExternalStore(subscribe, snapshot, serverSnapshot), setDensity }
}
