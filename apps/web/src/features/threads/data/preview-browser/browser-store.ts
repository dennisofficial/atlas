import { parseBrowserState, serializeBrowserState, storageKeyOf } from './browser-persistence'
import type { BrowserState } from './browser-model'

export type BrowserChange = (context: { state: BrowserState }) => BrowserState

export type BrowserStore = {
  read: (threadId: string) => BrowserState
  readAll: () => Record<string, BrowserState>
  update: (args: { threadId: string; change: BrowserChange }) => void
  subscribe: (listener: () => void) => () => void
}

type StoreDeps = {
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined
}

export function createBrowserStore(deps: StoreDeps): BrowserStore {
  const { storage } = deps
  const states = new Map<string, BrowserState>()
  const listeners = new Set<() => void>()
  let snapshot: Record<string, BrowserState> = {}

  const load = (threadId: string): BrowserState => {
    let raw: string | null = null
    try {
      raw = storage?.getItem(storageKeyOf(threadId)) ?? null
    } catch {}
    return parseBrowserState(raw)
  }

  const read = (threadId: string): BrowserState => {
    const held = states.get(threadId)
    if (held !== undefined) return held
    const loaded = load(threadId)
    states.set(threadId, loaded)
    snapshot = { ...snapshot, [threadId]: loaded }
    return loaded
  }

  const persist = (args: { threadId: string; state: BrowserState }) => {
    try {
      storage?.setItem(storageKeyOf(args.threadId), serializeBrowserState(args.state))
    } catch {}
  }

  const update: BrowserStore['update'] = ({ threadId, change }) => {
    const current = read(threadId)
    const next = change({ state: current })
    if (next === current) return
    states.set(threadId, next)
    snapshot = { ...snapshot, [threadId]: next }
    persist({ threadId, state: next })
    for (const listener of listeners) listener()
  }

  const subscribe: BrowserStore['subscribe'] = (listener) => {
    listeners.add(listener)
    return () => void listeners.delete(listener)
  }

  return { read, readAll: () => snapshot, update, subscribe }
}
