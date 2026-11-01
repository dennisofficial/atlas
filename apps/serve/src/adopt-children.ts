import { EAgentStatus, isResumable, type EventLogPort, type ThreadId } from '@dltech/atlas-core'

import type { AgentRegistryPort } from '@dltech/atlas-harness'
import type { AgentSnapshot } from '@dltech/atlas-harness'

export type ChildAdoptionDeps = {
  agents: Pick<AgentRegistryPort, 'hydrate' | 'list' | 'resume' | 'wake'>
  log: Pick<EventLogPort, 'readOwn'>
}

/**
 * A cloud boot leaves every interrupted child's durable log resumable and nobody
 * watching it: the sandbox that starts serving the parent thread must pick each one back up
 * itself, exactly as a restart resumes the parent, because no client ever asks for a child by id.
 *
 * A child the roster already carries as terminal is never picked up: its own log can still read
 * resumable (the interruption that cut it is recorded there), but its ending outranks that — a
 * teammate the operator stopped on the far side must stay stopped here.
 *
 * A relocation-paused child is the exception: it carries an `endedAt` yet was never finished, and
 * its own log can end cleanly (a held child paused with its model turn complete), so it is not
 * resumable mid-turn. It is woken into a fresh turn instead, never left silently paused.
 */
const endedBefore = (child: AgentSnapshot): boolean =>
  child.status !== EAgentStatus.Running &&
  child.status !== EAgentStatus.Paused &&
  child.endedAt !== undefined

export async function adoptChildren({
  agents,
  log,
  threadId,
}: ChildAdoptionDeps & { threadId: ThreadId }): Promise<readonly ThreadId[]> {
  await agents.hydrate({ threadId })

  const resumed: ThreadId[] = []
  for (const child of agents.list({ threadId })) {
    if (endedBefore(child)) continue
    const events = await log.readOwn({ threadId: child.agentId })
    const pausedAtCleanTail = !isResumable(events) && child.status === EAgentStatus.Paused
    if (!isResumable(events) && !pausedAtCleanTail) continue

    const outcome = pausedAtCleanTail
      ? await agents.wake({ agentId: child.agentId })
      : await agents.resume({ agentId: child.agentId, threadId })
    if (outcome.ok) resumed.push(child.agentId)
  }

  return resumed
}
