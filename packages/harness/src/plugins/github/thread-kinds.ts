import { isTeammateType, type ThreadId } from '@dltech/atlas-core'

import type { ThreadStorePort } from '../../store/thread-store'

export type ThreadKinds = {
  /**
   * The thread a notice for `threadId` belongs to: the nearest main or teammate ancestor for a
   * subagent, the thread itself otherwise. An unknown thread resolves to itself.
   */
  ownerOf: (args: { threadId: ThreadId }) => Promise<ThreadId>
}

/**
 * PR and CI notices belong to the thread the operator could answer them from — a main thread or a
 * teammate — never to a subagent, which works in its spawner's checkout only for the length of one
 * bounded task. Kinds are memoized because a thread's `agent` record is written once at creation
 * and never changes.
 */
export function createThreadKinds(args: { threads: ThreadStorePort }): ThreadKinds {
  const threads = args.threads
  const memo = new Map<ThreadId, Promise<ThreadId>>()

  const ownerOf = (request: {
    threadId: ThreadId
    seen?: ReadonlySet<ThreadId>
  }): Promise<ThreadId> => {
    const seen = request.seen ?? new Set<ThreadId>()
    if (seen.has(request.threadId)) return Promise.resolve(request.threadId)

    const cached = memo.get(request.threadId)
    if (cached !== undefined) return cached

    const resolved = threads
      .find({ threadId: request.threadId })
      .then((thread) => {
        if (thread?.agent === undefined || isTeammateType(thread.agent.type))
          return request.threadId
        return ownerOf({
          threadId: thread.agent.spawnedBy,
          seen: new Set([...seen, request.threadId]),
        })
      })
      .catch(() => request.threadId)

    memo.set(request.threadId, resolved)
    return resolved
  }

  return { ownerOf: ({ threadId }) => ownerOf({ threadId }) }
}

/** Specs and boot paths with no thread store: every thread owns its own notices. */
export const IDENTITY_THREAD_KINDS: ThreadKinds = {
  ownerOf: async ({ threadId }) => threadId,
}
