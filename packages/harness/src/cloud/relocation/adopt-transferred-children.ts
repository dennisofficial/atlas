import { EAgentRestart, isResumable, type EventLogPort, type ThreadId } from '@dltech/atlas-core'

import type { AgentRegistryPort } from '../../agents/registry/port'
import { resumableAfterTransfer } from '../../agents/registry/transferred-family'

export type TransferredAgentsPort = Pick<AgentRegistryPort, 'hydrate' | 'list' | 'resume'> &
  Partial<Pick<AgentRegistryPort, 'hydrateTransferred'>>

export async function adoptTransferredChildren(args: {
  agents: TransferredAgentsPort
  threadId: ThreadId
}): Promise<void> {
  if (args.agents.hydrateTransferred === undefined) {
    await args.agents.hydrate({ threadId: args.threadId })
    return
  }
  await args.agents.hydrateTransferred({ threadId: args.threadId })
}

export async function activateTransferredChildren(args: {
  agents: TransferredAgentsPort
  log: Pick<EventLogPort, 'readOwn'>
  threadId: ThreadId
}): Promise<readonly ThreadId[]> {
  const { agents, log } = args
  const resumed: ThreadId[] = []
  const visited = new Set<ThreadId>()
  const owners: ThreadId[] = [args.threadId]

  for (let owner = owners.shift(); owner !== undefined; owner = owners.shift()) {
    if (visited.has(owner)) continue
    visited.add(owner)

    for (const child of agents.list({ threadId: owner })) {
      owners.push(child.agentId)
      if (!resumableAfterTransfer(child)) continue
      if (!isResumable(await log.readOwn({ threadId: child.agentId }))) continue

      const outcome = await agents.resume({
        agentId: child.agentId,
        threadId: owner,
        via: EAgentRestart.Relocation,
      })
      if (outcome.ok) resumed.push(child.agentId)
    }
  }

  return resumed
}
