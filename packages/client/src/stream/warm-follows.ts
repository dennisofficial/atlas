export const WARM_FOLLOW_LIMIT = 8

export type WarmKey = { sessionId: string; threadId?: string | undefined }

export type WarmFollows<T> = {
  take(key: WarmKey): T | undefined
  keep(args: { key: WarmKey; entry: T }): void
}

const keyOf = ({ sessionId, threadId }: WarmKey): string => `${sessionId}\u0000${threadId ?? ''}`

export const createWarmFollows = <T>(limit: number = WARM_FOLLOW_LIMIT): WarmFollows<T> => {
  const held = new Map<string, T>()
  return {
    take: (key) => {
      const id = keyOf(key)
      const entry = held.get(id)
      held.delete(id)
      return entry
    },
    keep: ({ key, entry }) => {
      const id = keyOf(key)
      held.delete(id)
      held.set(id, entry)
      for (const oldest of held.keys()) {
        if (held.size <= limit) return
        held.delete(oldest)
      }
    },
  }
}
