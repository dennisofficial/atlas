import {
  EAgentStatus,
  EKilledBy,
  EServiceStatus,
  EShellStatus,
  rewindPlan,
  rewindTarget,
  type ClockPort,
  type ERewindRefusal,
  type IdPort,
  type RewindCut,
  type ThreadId,
} from '@dltech/atlas-core'

import type { AgentRegistryPort } from '../../../agents/registry/port'
import type { UnloggedChild } from '../../../agents/registry/snapshot'
import type { ServiceRegistryPort } from '../../../services/service-registry'
import type { ShellRegistryPort } from '../../../shells/shell-registry'
import type { RewindKill } from '../../rewind'
import type { JsonlEventLog } from '../event-log'
import type { SessionRegistry } from '../registry'
import { dropRewoundChildren } from './children'
import { appendDrafts, truncateThreadLog } from './log-edits'

export type { RewindKill } from '../../rewind'

export type SessionRewindResult =
  | { ok: true; discarded: number; kills: readonly RewindKill[]; orphans: readonly UnloggedChild[] }
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

export async function rewindThread({
  log,
  registry,
  clock,
  ids,
  agents,
  shells,
  services,
  threadId,
  toSeq,
  confirmed = false,
}: {
  log: JsonlEventLog
  registry: SessionRegistry
  clock: ClockPort
  ids: IdPort
  agents: AgentRegistryPort
  shells: ShellRegistryPort
  services: ServiceRegistryPort
  threadId: ThreadId
  toSeq: number
  confirmed?: boolean
}): Promise<SessionRewindResult> {
  const sessionDir = await log.sessionDirFor({ threadId })
  const handle = registry.handleFor({ sessionDir })

  return registry.enqueue({
    handle,
    run: async (): Promise<SessionRewindResult> => {
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
      await truncateThreadLog({ registry, clock, sessionDir, threadId, toSeq })
      const { orphans } = await dropRewoundChildren({
        registry,
        sessionDir,
        agentIds: cutAgents,
        at: clock.now(),
      })

      for (const notice of plan.reappend) {
        await appendDrafts({
          registry,
          clock,
          ids,
          sessionDir,
          threadId,
          runId: notice.runId,
          drafts: [notice.draft],
        })
      }

      shells.removeShells({ threadId, shellIds: cutShellIds, by: EKilledBy.Rewind })
      services.removeServices({ serviceIds: cutServiceIds, by: EKilledBy.Rewind })

      return {
        ok: true,
        discarded: owned.filter((event) => event.seq > toSeq).length - plan.reappend.length,
        kills,
        orphans,
      }
    },
  })
}
