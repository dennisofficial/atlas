import { EAgentStatus, EShellStatus, EServiceStatus, type EventLogPort, type IdPort, type LogPort } from '@dltech/atlas-core'

import type { AgentRegistryPort } from '../agents/registry/port'
import { MessageIntake, noticeSources, operatorSource, type IntakeSource } from '../intake'
import type { PendingQueues } from '../pending'
import type { ServiceRegistryPort } from '../services/service-registry'
import type { ShellRegistryPort } from '../shells/shell-registry'
import { teardownSession, type TeardownSource } from './session-teardown'

export function bindIntake<Command>(args: {
  pending: PendingQueues<Command>
  shells: ShellRegistryPort
  agents: AgentRegistryPort
  services: ServiceRegistryPort
  log: EventLogPort
  ids: IdPort
  logPort?: LogPort | undefined
  pluginSources?: readonly IntakeSource[] | undefined
}): { intake: MessageIntake; recordTeardownEndings: () => Promise<void> } {
  const { agents, shells, services, pending, log, ids } = args
  const intake = new MessageIntake({
    sources: [
      ...noticeSources({ shells, agents, services }),
      ...(args.pluginSources ?? []),
      operatorSource(pending),
    ],
    submit: ({ threadId, ...said }) => pending.forThread({ threadId }).enqueue(said),
  })
  intake.registerFallback(({ threadId }) => {
    if (!agents.listEverywhere().some((agent) => agent.agentId === threadId)) return undefined
    return {
      blocked: () => {
        const current = agents.listEverywhere().find((agent) => agent.agentId === threadId)
        return current === undefined || current.status === EAgentStatus.Running || current.killedBy !== undefined
      },
      wake: () => agents.wake({ agentId: threadId }),
    }
  })
  const unsubscribeRoster = agents.onChange(() => intake.changed())
  return {
    intake,
    recordTeardownEndings: async () => {
      intake.suspend()
      unsubscribeRoster()
      const prepareAgents = agents.prepareNotifications?.bind(agents)
      const shellEndings: TeardownSource = {
        closeAll: () => shells.detachAll(),
        threadsAwaitingNotice: () => shells.threadsAwaitingNotice(),
        threadsWithPendingInput: () => shells.threadsWithPendingInput?.() ?? shells.threadsAwaitingNotice(),
        prepareNotifications: shells.prepareNotifications?.bind(shells),
        drainNotifications: (request) => shells.drainNotifications(request),
        liveUnitIds: () =>
          shells.listEverywhere().flatMap((shell) => (shell.status === EShellStatus.Running ? [shell.shellId] : [])),
      }
      const agentEndings: TeardownSource = {
        closeAll: () => agents.closeAll(),
        threadsAwaitingNotice: () => agents.threadsAwaitingNotice(),
        threadsWithPendingInput: () => agents.threadsWithPendingInput?.() ?? agents.threadsAwaitingNotice(),
        prepareNotifications: prepareAgents,
        drainNotifications: (request) => agents.drainNotifications(request).drafts,
        liveUnitIds: () => agents.listEverywhere().map((agent) => agent.agentId),
      }
      const serviceEndings: TeardownSource = {
        closeAll: () => services.closeAll(),
        threadsAwaitingNotice: () => services.threadsAwaitingNotice(),
        drainNotifications: (request) => services.drainNotifications(request),
        liveUnitIds: () =>
          services.list().flatMap((service) => (service.status === EServiceStatus.Running ? [service.serviceId] : [])),
      }
      try {
        await teardownSession({
          sources: [shellEndings, agentEndings, serviceEndings],
          log,
          ids,
          intake,
          ownedKinds: { agents: agentEndings, shells: shellEndings, services: serviceEndings },
          logPort: args.logPort,
        })
      } finally {
        intake.dispose()
      }
    },
  }
}
