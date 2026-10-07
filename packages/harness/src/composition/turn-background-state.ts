import { EAgentStatus, EServiceStatus, EShellStatus, type ThreadId } from '@dltech/atlas-core'

import type { AgentRegistryPort } from '../agents/registry/port'
import type { ServiceRegistryPort } from '../services/service-registry'
import type { ShellRegistryPort } from '../shells/shell-registry'

export function turnBackgroundState(args: {
  agents: AgentRegistryPort
  shells: ShellRegistryPort
  services: ServiceRegistryPort
}) {
  return {
    runningShells: ({ threadId }: { threadId: ThreadId }) => args.shells.list({ threadId })
      .filter((shell) => shell.status === EShellStatus.Running)
      .map((shell) => ({
        shellId: shell.shellId,
        command: shell.command,
        description: shell.description,
        awaitingInput: shell.awaitingInput,
        totalCharacters: shell.totalCharacters,
      })),
    runningAgents: ({ threadId }: { threadId: ThreadId }) => args.agents.list({ threadId })
      .filter((agent) => agent.status === EAgentStatus.Running)
      .map((agent) => ({ agentId: agent.agentId, agentType: agent.agentType, intent: agent.intent })),
    runningServices: () => args.services.list()
      .filter((service) => service.status === EServiceStatus.Running)
      .map((service) => ({
        serviceId: service.serviceId,
        command: service.command,
        description: service.description,
        logPath: service.logPath,
      })),
  }
}
