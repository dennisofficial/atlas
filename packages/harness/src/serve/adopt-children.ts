import { isResumable, type EventLogPort, type ThreadId } from '@dltech/atlas-core'

import type { AgentRegistryPort } from '../agents/registry/port'

export type ChildAdoptionDeps = {
  agents: Pick<AgentRegistryPort, 'hydrate' | 'list' | 'resume'>
  log: Pick<EventLogPort, 'readOwn'>
}

/**
 * A lift's child transfer leaves every interrupted child's durable log resumable and nobody
 * watching it: the sandbox that starts serving the parent thread must pick each one back up
 * itself, exactly as a restart resumes the parent, because no client ever asks for a child by id.
 */
export async function adoptChildren({
  agents,
  log,
  threadId,
}: ChildAdoptionDeps & { threadId: ThreadId }): Promise<readonly ThreadId[]> {
  await agents.hydrate({ threadId })

  const resumed: ThreadId[] = []
  for (const child of agents.list({ threadId })) {
    const events = await log.readOwn({ threadId: child.agentId })
    if (!isResumable(events)) continue

    const outcome = await agents.resume({ agentId: child.agentId, threadId })
    if (outcome.ok) resumed.push(child.agentId)
  }

  return resumed
}
