import type { JsonStore } from '../storage/json-store'

const SELECTED_SESSION_KEY = 'selected-session'

export type TSelectedSessionStore = {
  load: () => Promise<string | null>
  select: (id: string | null) => void
  current: () => string | null
  loaded: () => boolean
  subscribe: (listener: () => void) => () => void
}

export const createSelectedSessionStore = ({
  store,
}: {
  store: JsonStore
}): TSelectedSessionStore => {
  let value: string | null = null
  let read = false
  let chosen = false
  const listeners = new Set<() => void>()

  const emit = (): void => {
    for (const listener of listeners) listener()
  }

  const persist = (id: string | null): void => {
    const write =
      id === null ? store.remove(SELECTED_SESSION_KEY) : store.write(SELECTED_SESSION_KEY, id)
    void write.catch(() => undefined)
  }

  return {
    load: async () => {
      const stored = await store.read(SELECTED_SESSION_KEY).catch(() => undefined)
      if (!chosen) value = typeof stored === 'string' ? stored : null
      read = true
      emit()
      return value
    },
    select: (id) => {
      chosen = true
      if (value === id) return
      value = id
      emit()
      persist(id)
    },
    current: () => value,
    loaded: () => read,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
