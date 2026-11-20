import { toThreadId, type ThreadId } from '@dltech/atlas-core'
import type { SessionsClient } from '@dltech/atlas-harness'

export type FamilyParent = { agentId: ThreadId; spawnedBy: ThreadId }

/** A thread with no agent under it cannot have spawned one, so only branch points are listed. */
const parentsOf = (args: { root: ThreadId; agents: readonly FamilyParent[] }): ThreadId[] => {
  const spawners = new Set(args.agents.map((agent) => agent.spawnedBy))
  return [
    args.root,
    ...args.agents.filter((agent) => spawners.has(agent.agentId)).map((a) => a.agentId),
  ]
}

/**
 * The remote head of every thread in the family in one listing request per branch point, rather
 * than one history read per thread: what a pull compares against its local head before reading.
 */
export async function familyHeads(args: {
  root: ThreadId
  agents: readonly FamilyParent[]
  threads: Pick<SessionsClient, 'spawnedThreads'>
}): Promise<ReadonlyMap<ThreadId, number>> {
  const heads = new Map<ThreadId, number>()
  const listed = await Promise.all(
    parentsOf(args).map((parent) => args.threads.spawnedThreads({ threadId: parent })),
  )
  for (const child of listed.flat()) {
    const id = toThreadId(child.id)
    if (!heads.has(id)) heads.set(id, child.head)
  }
  return heads
}
