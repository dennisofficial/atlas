import type { ThreadId } from '@dltech/atlas-core'

import type { ThreadStorePort } from '../store'

const MAX_ANCESTRY = 32

export async function rootThreadOf({
  threads,
  threadId,
}: {
  threads: Pick<ThreadStorePort, 'find'>
  threadId: ThreadId
}): Promise<ThreadId> {
  let current = threadId
  for (let hops = 0; hops < MAX_ANCESTRY; hops += 1) {
    const parent = (await threads.find({ threadId: current }))?.agent?.spawnedBy
    if (parent === undefined) return current
    current = parent
  }
  return current
}
