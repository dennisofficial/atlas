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

export async function teammatesOf({
  threads,
  threadId,
}: {
  threads: ThreadStorePort
  threadId: ThreadId
}): Promise<readonly ThreadId[]> {
  const teammates: ThreadId[] = []
  const visited = new Set<ThreadId>([threadId])
  const pending = [threadId]
  for (let next = pending.shift(); next !== undefined; next = pending.shift()) {
    const children = await threads.spawned({ threadId: next }).catch(() => [])
    for (const child of children) {
      if (visited.has(child.id)) continue
      visited.add(child.id)
      pending.push(child.id)
      if (child.agent !== undefined && isTeammateType(child.agent.type)) teammates.push(child.id)
    }
  }
  return teammates
}

export const IDENTITY_THREAD_KINDS: ThreadKinds = {
  ownerOf: async ({ threadId }) => threadId,
}
