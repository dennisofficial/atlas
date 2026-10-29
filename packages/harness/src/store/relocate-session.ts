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
import { STOP_SETTLE_MS, type ServiceRegistryPort } from '../services/service-registry'

export type RelocatedSession = {
  stoppedServices: readonly ServiceSnapshot[]
  relocatedAgents: readonly ThreadId[]
  /** Services that had not recorded their exit within the settle bound; their endings arrive later. */
  stillStopping: number
}

export async function relocateSession({
  threadId,
  from,
  location,
  cwd,
  caller,
  log,
  ids,
  services,
  agents,
}: {
  threadId: ThreadId
  from: EExecutionLocation
  location: EExecutionLocation
  cwd?: string | undefined
  caller?: ThreadId | undefined
  log: EventLogPort
  ids: IdPort
  services: ServiceRegistryPort
  agents: AgentRegistryPort
}): Promise<RelocatedSession> {
  await log.append({
    threadId,
    runId: ids.nextRunId(),
    drafts: [
      { type: 'location-changed', from, to: location, ...(cwd === undefined ? {} : { cwd }) },
    ],
  })

  const stoppedServices: ServiceSnapshot[] = []
  for (const service of services.list()) {
    if (service.status !== EServiceStatus.Running) continue
    const stopped = await services.stop({
      serviceId: service.serviceId,
      by: EKilledBy.ContainerSwitch,
    })
    if (stopped.ok) stoppedServices.push(stopped.snapshot)
  }

  const endingsSettled = services.awaitEndings({ ms: STOP_SETTLE_MS })
  const relocatedAgents = await agents.relocateChildren({ threadId, location, caller })
  const stillStopping = await endingsSettled

  return { stoppedServices, relocatedAgents, stillStopping }
}
