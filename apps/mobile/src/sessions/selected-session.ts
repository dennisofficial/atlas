import { useEffect, useSyncExternalStore } from 'react'

import { createSelectedSessionStore, type TSelectedSessionStore } from './selected-session-store'
import { selectedSessionJsonStore } from './selected-session-source'

let singleton: TSelectedSessionStore | undefined

export const selectedSessionStore = (): TSelectedSessionStore =>
  (singleton ??= createSelectedSessionStore({ store: selectedSessionJsonStore() }))

let loadStarted = false

const loadOnce = (store: TSelectedSessionStore): void => {
  if (loadStarted) return
  loadStarted = true
  void store.load()
}

export const useSelectedSession = (): string | null => {
  const store = selectedSessionStore()
  useEffect(() => loadOnce(store), [store])
  return useSyncExternalStore(store.subscribe, store.current, () => null)
}

export const useSelectedSessionLoaded = (): boolean => {
  const store = selectedSessionStore()
  useEffect(() => loadOnce(store), [store])
  return useSyncExternalStore(store.subscribe, store.loaded, () => false)
}
