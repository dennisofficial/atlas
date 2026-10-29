import type { AtlasApp } from './compose'
import type { OpenedConversation } from './open-conversation'

export type CachedTranscriptStore = {
  snapshot: () => OpenedConversation | null
  subscribe: (listener: () => void) => () => void
  put: (opened: OpenedConversation | null) => void
}

const stores = new WeakMap<object, CachedTranscriptStore>()

function createStore(): CachedTranscriptStore {
  const listeners = new Set<() => void>()
  let held: OpenedConversation | null = null
  return {
    snapshot: () => held,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    put: (opened) => {
      if (opened === held) return
      held = opened
      for (const listener of [...listeners]) listener()
    },
  }
}

export function cachedTranscripts(app: Pick<AtlasApp, 'sessionOwner'>): CachedTranscriptStore {
  const existing = stores.get(app.sessionOwner)
  if (existing !== undefined) return existing
  const created = createStore()
  stores.set(app.sessionOwner, created)
  return created
}
