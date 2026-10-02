import type { ThreadId } from '@dltech/atlas-core'

export type FreezeSource = (args: { threadId: ThreadId }) => Promise<() => void>

export type SessionFreezes = {
  has: (threadId: ThreadId) => boolean
  hold: (args: { threadId: ThreadId; freeze: FreezeSource | undefined }) => Promise<void>
  release: (threadId: ThreadId) => void
}

export function createSessionFreezes(): SessionFreezes {
  const held = new Map<ThreadId, () => void>()

  return {
    has: (threadId) => held.has(threadId),
    hold: async ({ threadId, freeze }) => {
      if (freeze === undefined || held.has(threadId)) return
      held.set(threadId, await freeze({ threadId }))
    },
    release: (threadId) => {
      const release = held.get(threadId)
      held.delete(threadId)
      try {
        release?.()
      } catch {
        return
      }
    },
  }
}
