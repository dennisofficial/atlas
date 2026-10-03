import {
  agentRoster,
  EAgentStatus,
  EKilledBy,
  parseRef,
  projectDirectoryOf,
  type ClockPort,
  type EventLogPort,
  type ProviderIdentity,
  type ThreadId,
} from '@dltech/atlas-core'

import type { ThreadStorePort } from '../../store'
import { isStepping, recoveredChild, reviseFromTransfer } from './child-state'
import { forgetRemovedChildren } from './remove-children'
import type { AgentNoticeQueue } from './notices'
import type { ChildState } from './child-state'
import type { AgentRoster } from './roster'
import type { AgentSnapshot } from './snapshot'

export type TransferredOwner = {
  threadId: ThreadId
  agentIds: readonly ThreadId[]
}

export async function storedModelOf({
  threads,
  agentId,
}: {
  threads: ThreadStorePort
  agentId: ThreadId
}): Promise<ProviderIdentity | undefined> {
  const thread = await threads.find({ threadId: agentId })
  const ref = thread?.model === undefined ? undefined : parseRef(thread.model.ref)
  return ref === undefined ? undefined : { id: ref.providerId, modelId: ref.modelId }
}

async function directoryOfTransferred({
  log,
  threads,
  agentId,
  inherited,
}: {
  log: EventLogPort
  threads: ThreadStorePort
  agentId: ThreadId
  inherited: string
}): Promise<string> {
  const thread = await threads.find({ threadId: agentId })
  return projectDirectoryOf({
    events: await log.readOwn({ threadId: agentId }),
    launchDirectory: thread?.workspace ?? inherited,
  })
}

export async function refreshTransferredFamily({
  threadId,
  log,
  threads,
  clock,
  roster,
  notices,
  launchDirectory,
}: {
  threadId: ThreadId
  log: EventLogPort
  threads: ThreadStorePort
  clock: ClockPort
  roster: AgentRoster
  notices: AgentNoticeQueue
  launchDirectory: string
}): Promise<readonly TransferredOwner[]> {
  await log.refresh({ threadId })

  const owners: TransferredOwner[] = []
  const added: ChildState[] = []
  const visited = new Set<ThreadId>()
  const queue: { owner: ThreadId; directory: string }[] = [
    {
      owner: threadId,
      directory: projectDirectoryOf({ events: await log.readOwn({ threadId }), launchDirectory }),
    },
  ]

  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const { owner } = next
    if (visited.has(owner)) continue
    visited.add(owner)

    const agents = agentRoster({ events: await log.readOwn({ threadId: owner }), threadId: owner })
    const named = new Set(agents.map((agent) => agent.agentId))
    const revised: ThreadId[] = []

    for (const agent of agents) {
      const directory = await directoryOfTransferred({
        log,
        threads,
        agentId: agent.agentId,
        inherited: next.directory,
      })
      queue.push({ owner: agent.agentId, directory })

      const existing = roster.find(agent.agentId)
      if (existing !== undefined && existing.spawnedBy !== owner) continue
      if (existing !== undefined && isStepping(existing)) continue

      const model = await storedModelOf({ threads, agentId: agent.agentId })
      revised.push(agent.agentId)

      if (existing === undefined) {
        const child = recoveredChild({ agent, spawnedBy: owner, at: clock.now() })
        child.model = model
        child.projectDirectory = directory
        added.push(child)
        continue
      }

      reviseFromTransfer({ child: existing, agent })
      existing.model = model
      existing.projectDirectory = directory
    }

    const gone = roster
      .states()
      .filter((child) => child.spawnedBy === owner && !named.has(child.agentId) && !isStepping(child))
      .map((child) => child.agentId)
    if (gone.length > 0) {
      forgetRemovedChildren({ roster, notices, threadId: owner, agentIds: gone })
      revised.push(...gone)
    }

    owners.push({ threadId: owner, agentIds: revised })
  }

  roster.addAll(added)
  return owners
}

export function resumableAfterTransfer(child: AgentSnapshot): boolean {
  if (child.status === EAgentStatus.Paused) return true
  if (child.status !== EAgentStatus.Stopped) return false
  return child.killedBy === undefined || child.killedBy === EKilledBy.ContainerSwitch
}
