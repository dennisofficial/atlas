import {
  EExecutionLocation,
  EKilledBy,
  EServiceStatus,
  type EventLogPort,
  type IdPort,
  type ThreadId,
} from '@dltech/atlas-core'

import type { AgentRegistryPort } from '../agents/registry/port'
import type { ServiceSnapshot } from '../services/service-process'
import type { ServiceRegistryPort } from '../services/service-registry'
import type { ThreadStorePort } from './thread-store'

export type RelocatedSession = {
  stoppedServices: readonly ServiceSnapshot[]
  relocatedAgents: readonly ThreadId[]
}

export async function relocateSession({
  threadId,
  location,
  threads,
  log,
  ids,
  services,
  agents,
}: {
  threadId: ThreadId
  location: EExecutionLocation
  threads: ThreadStorePort
  log: EventLogPort
  ids: IdPort
  services: ServiceRegistryPort
  agents: AgentRegistryPort
}): Promise<RelocatedSession> {
  const stored = await threads.find({ threadId })
  const from = stored?.executionLocation ?? EExecutionLocation.Host
  await log.append({
    threadId,
    runId: ids.nextRunId(),
    drafts: [{ type: 'location-changed', from, to: location }],
  })
  await threads.chooseExecutionLocation({ threadId, location })

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
