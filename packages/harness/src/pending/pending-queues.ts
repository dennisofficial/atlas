import type { ThreadId } from '@dltech/atlas-core'

import {
  createPendingQueue,
  NO_EXPANSION,
  type ExpandContext,
  type PendingQueue,
} from './pending-queue'

export type PendingQueues<Command = never> = {
  forThread(args: { threadId: ThreadId }): PendingQueue<Command>
  waitingCount(): number
  expandContext: ExpandContext
  subscribe(listener: () => void): () => void
  threadsAwaitingInput(): readonly ThreadId[]
}

export function createPendingQueues<Command = never>(
  options: { expandContext?: ExpandContext } = {},
): PendingQueues<Command> {
  const expandContext = options.expandContext ?? NO_EXPANSION
  const queues = new Map<ThreadId, PendingQueue<Command>>()
  const listeners = new Set<() => void>()

  return {
    expandContext,

    forThread({ threadId }) {
      const held = queues.get(threadId)
      if (held !== undefined) return held

      const created = createPendingQueue<Command>(options)
      queues.set(threadId, created)
      created.subscribe(() => {
        for (const listener of [...listeners]) listener()
      })
      return created
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },

    threadsAwaitingInput() {
      return [...queues]
        .filter(([, queue]) => queue.getSnapshot().some((entry) => entry.kind === 'message'))
        .map(([threadId]) => threadId)
    },

    waitingCount() {
      let count = 0
      for (const queue of queues.values()) {
        count += queue.getSnapshot().filter((entry) => entry.kind === 'message').length
      }
      return count
    },
  }
}
