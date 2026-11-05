'use client'

import { useCallback, useSyncExternalStore } from 'react'

import { freshBrowser, type BrowserState } from './browser-model'
import { createBrowserStore, type BrowserChange } from './browser-store'

const readStorage = (): Storage | undefined => {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

let held: ReturnType<typeof createBrowserStore> | undefined

const storeOf = () => {
  held ??= createBrowserStore({ storage: readStorage(), now: Date.now })
  return held
}

const subscribe = (listener: () => void) => storeOf().subscribe(listener)

const SERVER_STATE: BrowserState = freshBrowser({ now: 0 })
const SERVER_ALL: Record<string, BrowserState> = {}

export function usePreviewBrowser(threadId: string) {
  const state = useSyncExternalStore(
    subscribe,
    () => storeOf().read(threadId),
    () => SERVER_STATE,
  )
  const update = useCallback(
    (change: BrowserChange) => storeOf().update({ threadId, change }),
    [threadId],
  )
  return { state, update }
}

export function useAllPreviewBrowsers(): Record<string, BrowserState> {
  return useSyncExternalStore(
    subscribe,
    () => storeOf().readAll(),
    () => SERVER_ALL,
  )
}
