import {
  EAgentStatus,
  EKilledBy,
  EServiceStatus,
  EShellStatus,
  type RewindCut,
  type ThreadId,
} from '@dltech/atlas-core'

import type { AgentRegistryPort } from '../agents/registry/port'
import type { ServiceRegistryPort } from '../services/service-registry'
import type { ShellRegistryPort } from '../shells/shell-registry'

import type { RewindKill } from './rewind'
import { RewindMachineryPort, type RewindRead } from './rewind-machinery'

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

export class LocalRewindMachinery extends RewindMachineryPort {
  private readonly registries: Registries

  constructor(args: Registries) {
    super()
    this.registries = args
  }

  snapshot(args: { cuts: readonly RewindCut[]; threadId: ThreadId }): Promise<RewindRead> {
    return Promise.resolve({
      reachable: true,
      kills: args.cuts.map((cut) => withLiveness(cut, args.threadId, this.registries)),
    })
  }

  async destroy(args: {
    cuts: readonly RewindCut[]
    threadId: ThreadId
    toSeq?: number | undefined
  }): Promise<void> {
    const cutAgents = args.cuts.flatMap((cut) => (cut.kind === 'agent' ? [cut.agentId] : []))
    const cutShellIds = args.cuts.flatMap((cut) => (cut.kind === 'shell' ? [cut.shellId] : []))
    const cutServiceIds = args.cuts.flatMap((cut) =>
      cut.kind === 'service' ? [cut.serviceId] : [],
    )

    await this.registries.agents.removeChildren({ threadId: args.threadId, agentIds: cutAgents })
    this.registries.shells.removeShells({
      threadId: args.threadId,
      shellIds: cutShellIds,
      by: EKilledBy.Rewind,
    })
    this.registries.services.removeServices({ serviceIds: cutServiceIds, by: EKilledBy.Rewind })
  }
}
