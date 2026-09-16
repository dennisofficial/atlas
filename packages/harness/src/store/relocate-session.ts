import {
  EKilledBy,
  EServiceStatus,
  type EExecutionLocation,
  type EventLogPort,
  type IdPort,
  type ThreadId,
} from '@dltech/atlas-core'

import type { AgentRegistryPort } from '../agents/registry/port'
import type { ServiceSnapshot } from '../services/service-process'
import type { ServiceRegistryPort } from '../services/service-registry'

export type RelocatedSession = {
  stoppedServices: readonly ServiceSnapshot[]
  relocatedAgents: readonly ThreadId[]
}

export async function relocateSession({
  threadId,
  from,
  location,
  log,
  ids,
  services,
  agents,
}: {
  threadId: ThreadId
  from: EExecutionLocation
  location: EExecutionLocation
  log: EventLogPort
  ids: IdPort
  services: ServiceRegistryPort
  agents: AgentRegistryPort
}): Promise<RelocatedSession> {
  await log.append({
    threadId,
    runId: ids.nextRunId(),
    drafts: [{ type: 'location-changed', from, to: location }],
  })

  const stoppedServices = services
    .list()
    .filter((service) => service.status === EServiceStatus.Running)
    .flatMap((service) => {
      const stopped = services.stop({ serviceId: service.serviceId, by: EKilledBy.ContainerSwitch })
      return stopped.ok ? [stopped.snapshot] : []
    })

  const relocatedAgents = await agents.relocateChildren({ threadId, location })

  return { stoppedServices, relocatedAgents }
}
