import type { ThreadId } from '@dltech/atlas-core'

export type ThreadSource = {
  snapshot: () => { threadId: ThreadId | undefined }
  subscribe: (listener: () => void) => () => void
}

export type VisibleThread = {
  threadId: () => ThreadId | undefined
  subscribe: (listener: () => void) => () => void
  attach: (source: ThreadSource) => void
}

export function createVisibleThread(): VisibleThread {
  const listeners = new Set<() => void>()
  let source: ThreadSource | null = null
  let detach: (() => void) | null = null

  const announce = (): void => {
    for (const listener of listeners) listener()
  }

  return {
    threadId: () => source?.snapshot().threadId,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    attach: (next) => {
      detach?.()
      source = next
      detach = next.subscribe(announce)
      announce()
    },
  }
}
