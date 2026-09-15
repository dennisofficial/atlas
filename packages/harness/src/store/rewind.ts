import {
  EAgentStatus,
  EKilledBy,
  EServiceStatus,
  EShellStatus,
  rewindPlan,
  rewindTarget,
  type ERewindRefusal,
  type EventLogPort,
  type RewindCut,
  type ThreadId,
} from '@dltech/atlas-core'

import type { AgentRegistryPort } from '../agents/registry/port'
import type { ServiceRegistryPort } from '../services/service-registry'
import type { ShellRegistryPort } from '../shells/shell-registry'
import type { ThreadStorePort } from './thread-store'

export type RewindKill =
  | {
      kind: 'agent'
      agentId: ThreadId
      agentType: string
      intent: string
      running: boolean
    }
  | {
      kind: 'shell'
      shellId: string
      command: string | undefined
      description: string | undefined
      running: boolean
    }
  | {
      kind: 'service'
      serviceId: string
      command: string | undefined
      description: string | undefined
      running: boolean
    }

export type RewindResult =
  | { ok: true; discarded: number; kills: readonly RewindKill[] }
  | { ok: false; refusal: ERewindRefusal; reason: string }
  | { ok: false; needsConfirmation: true; toSeq: number; kills: readonly RewindKill[] }

type Registries = {
  agents: AgentRegistryPort
  shells: ShellRegistryPort
  services: ServiceRegistryPort
}

const withLiveness = (cut: RewindCut, threadId: ThreadId, registries: Registries): RewindKill => {
  if (cut.kind === 'agent') {
    const snapshot = registries.agents
      .list({ threadId })
      .find((agent) => agent.agentId === cut.agentId)
    return {
      kind: 'agent',
      agentId: cut.agentId,
      agentType: cut.agentType,
      intent: cut.intent,
      running: snapshot?.status === EAgentStatus.Running,
    }
  }
  if (cut.kind === 'shell') {
    const snapshot = registries.shells
      .list({ threadId })
      .find((shell) => shell.shellId === cut.shellId)
    return {
      kind: 'shell',
      shellId: cut.shellId,
      command: snapshot?.command ?? cut.command,
      description: snapshot?.description ?? cut.description,
      running: snapshot?.status === EShellStatus.Running,
    }
  }
  const snapshot = registries.services
    .list()
    .find((service) => service.serviceId === cut.serviceId)
  return {
    kind: 'service',
    serviceId: cut.serviceId,
    command: snapshot?.command ?? cut.command,
    description: snapshot?.description ?? cut.description,
    running: snapshot?.status === EServiceStatus.Running,
  }
}

/**
 * A cut is anything the rewind would destroy — a spawned child, a background shell, a service —
 * so it is confirmed rather than refused: the operator picked the point, and the confirmation
 * names what dies. `confirmed` is that answer; without it a non-empty plan comes back as
 * `needsConfirmation` and nothing is written. Removal aborts stepping children before their
 * threads are deleted under them.
 */
export async function rewindThread({
  log,
  threads,
  agents,
  shells,
  services,
  threadId,
  toSeq,
  confirmed = false,
}: {
  log: EventLogPort
  threads: ThreadStorePort
  agents: AgentRegistryPort
  shells: ShellRegistryPort
  services: ServiceRegistryPort
  threadId: ThreadId
  toSeq: number
  confirmed?: boolean
}): Promise<RewindResult> {
  const events = await log.read({ threadId })
  const owned = await log.readOwn({ threadId })
  const firstOwned = owned[0]
  const floorSeq = firstOwned === undefined ? await log.head({ threadId }) : firstOwned.seq - 1

  const target = rewindTarget({ events, toSeq, floorSeq })
  if (!target.allowed) return { ok: false, refusal: target.refusal, reason: target.reason }

  const plan = rewindPlan({ events, toSeq })
  const kills = plan.cuts.map((cut) => withLiveness(cut, threadId, { agents, shells, services }))

  if (kills.length > 0 && !confirmed) {
    return { ok: false, needsConfirmation: true, toSeq, kills }
  }

  const cutAgents = plan.cuts.flatMap((cut) => (cut.kind === 'agent' ? [cut.agentId] : []))
  const cutShellIds = plan.cuts.flatMap((cut) => (cut.kind === 'shell' ? [cut.shellId] : []))
  const cutServiceIds = plan.cuts.flatMap((cut) => (cut.kind === 'service' ? [cut.serviceId] : []))

  await agents.removeChildren({ threadId, agentIds: cutAgents })

  await threads.rewind({ threadId, toSeq, cutAgents })

  for (const notice of plan.reappend) {
    await log.append({ threadId, runId: notice.runId, drafts: [notice.draft] })
  }

  shells.removeShells({ threadId, shellIds: cutShellIds, by: EKilledBy.Rewind })
  services.removeServices({ serviceIds: cutServiceIds, by: EKilledBy.Rewind })

  return {
    ok: true,
    discarded: owned.filter((event) => event.seq > toSeq).length - plan.reappend.length,
    kills,
  }
}
