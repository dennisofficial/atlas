import { useSyncExternalStore } from 'react'

export type ActiveNaming = { threadId: string; title: string | null; naming: boolean }
export type ThreadNaming = { title: string | null; naming: boolean }

export function createActiveNaming() {
  let current: ActiveNaming | null = null
  const listeners = new Set<() => void>()
  const emit = () => {
    for (const listener of listeners) listener()
  }
  return {
    publish: (next: ActiveNaming) => {
      const same =
        current?.threadId === next.threadId &&
        current.title === next.title &&
        current.naming === next.naming
      if (same) return
      current = next
      emit()
    },
    clear: (threadId: string) => {
      if (current?.threadId !== threadId) return
      current = null
      emit()
    },
    read: (threadId: string): ThreadNaming | null =>
      current?.threadId === threadId ? { title: current.title, naming: current.naming } : null,
    snapshot: () => current,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
  }
}

export const activeNaming = createActiveNaming()

export function useThreadNaming(threadId: string): ThreadNaming | null {
  const snapshot = useSyncExternalStore(
    activeNaming.subscribe,
    activeNaming.snapshot,
    activeNaming.snapshot,
  )
  return snapshot?.threadId === threadId ? { title: snapshot.title, naming: snapshot.naming } : null
}
