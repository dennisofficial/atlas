import { isTeammateType, type ThreadId } from '@dltech/atlas-core'

import type { ThreadStorePort } from '../store/thread-store'

export type ThreadKinds = {
  ownerOf: (args: { threadId: ThreadId }) => Promise<ThreadId>
}

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

export const IDENTITY_THREAD_KINDS: ThreadKinds = {
  ownerOf: async ({ threadId }) => threadId,
}
