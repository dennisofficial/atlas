import { useMemo, useSyncExternalStore } from 'react'

import { EMPTY_TERMINALS, type TerminalSnapshot, withLink, withRows } from './terminal-model'

export type TerminalStore = {
  snapshot: () => TerminalSnapshot
  subscribe: (listener: () => void) => () => void
  update: (change: (snapshot: TerminalSnapshot) => TerminalSnapshot) => void
}

const createStore = (): TerminalStore => {
  let state = EMPTY_TERMINALS
  const listeners = new Set<() => void>()
  return {
    snapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    update: (change) => {
      const next = change(state)
      if (next === state) return
      state = next
      for (const listener of listeners) listener()
    },
  }
}

const stores = new Map<string, TerminalStore>()

export function terminalStoreOf(sessionId: string): TerminalStore {
  const existing = stores.get(sessionId)
  if (existing !== undefined) return existing
  const created = createStore()
  stores.set(sessionId, created)
  return created
}

export const forgetTerminalStore = (sessionId: string): void => {
  stores.delete(sessionId)
}

export function useTerminalStore(sessionId: string): TerminalStore {
  return useMemo(() => terminalStoreOf(sessionId), [sessionId])
}

const serverSnapshot = () => EMPTY_TERMINALS

export function useTerminals(sessionId: string): TerminalSnapshot {
  const store = useTerminalStore(sessionId)
  return useSyncExternalStore(store.subscribe, store.snapshot, serverSnapshot)
}

export { withLink, withRows }
