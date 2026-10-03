import {
  EKilledBy,
  EServiceStatus,
  type EventLogPort,
  type IdPort,
  type ThreadId,
} from '@dltech/atlas-core'
import {
  KILL_SETTLE_MS,
  recordWorkspaceArrival,
  STOP_SETTLE_MS,
  type ServiceRegistryPort,
  type ShellRegistryPort,
  type ThreadStorePort,
} from '@dltech/atlas-harness'

import type { ServeApp } from './serve-app'

export const familyThreadIdsOf = async (args: {
  root: ThreadId
  threads: Pick<ThreadStorePort, 'spawned'>
}): Promise<ReadonlySet<ThreadId>> => {
  const family = new Set<ThreadId>([args.root])
  for (const threadId of family) {
    for (const child of await args.threads.spawned({ threadId })) family.add(child.id)
  }
  return family
}

type FamilyShells = Pick<ShellRegistryPort, 'stopOwners'>

const STILL_WRITING = 'background processes are still writing to the workspace, so it cannot be captured consistently'

export function endFamilyShellsFor(args: {
  root: ThreadId
  shells: FamilyShells
  threads: Pick<ThreadStorePort, 'spawned'>
}): () => Promise<void> {
  return async () => {
    const family = await familyThreadIdsOf({ root: args.root, threads: args.threads })
    await args.shells.stopOwners({
      threadIds: [...family],
      by: EKilledBy.ContainerSwitch,
      ms: KILL_SETTLE_MS,
    })
  }
}

export function stopWorkspaceProcessesFor(args: {
  root: ThreadId
  shells: Pick<ShellRegistryPort, 'stopOwners' | 'drainNotifications'>
  services: Pick<ServiceRegistryPort, 'list' | 'stop' | 'awaitEndings' | 'drainNotifications'>
  threads: Pick<ThreadStorePort, 'spawned'>
  log: Pick<EventLogPort, 'append'>
  ids: Pick<IdPort, 'nextRunId'>
}): () => Promise<void> {
  const { shells, services } = args
  return async () => {
    const family = await familyThreadIdsOf({ root: args.root, threads: args.threads })
    const shellEndings = shells.stopOwners({
      threadIds: [...family],
      by: EKilledBy.ContainerSwitch,
      ms: KILL_SETTLE_MS,
    })
    for (const service of services.list()) {
      if (service.status === EServiceStatus.Running) {
        services.stop({ serviceId: service.serviceId, by: EKilledBy.ContainerSwitch })
      }
    }
    const [, stragglers] = await Promise.all([shellEndings, services.awaitEndings({ ms: STOP_SETTLE_MS })])
    const stillRunning = services.list().filter((service) => service.status === EServiceStatus.Running).length
    if (stillRunning > 0 || stragglers > 0) throw new Error(STILL_WRITING)
    for (const threadId of family) {
      const drafts = [
        ...shells.drainNotifications({ threadId }),
        ...services.drainNotifications({ threadId }),
      ]
      if (drafts.length === 0) continue
      await args.log.append({ threadId, runId: args.ids.nextRunId(), drafts })
    }
  }
}

export function workspaceHooksFor(args: {
  threadId: ThreadId
  shells: ShellRegistryPort
  services: ServiceRegistryPort
  log: EventLogPort
  threads: ThreadStorePort
  ids: IdPort
}): Pick<ServeApp, 'stopWorkspaceProcesses' | 'recordWorkspaceArrival'> & {
  endFamilyShells: () => Promise<void>
} {
  return {
    endFamilyShells: endFamilyShellsFor({
      root: args.threadId,
      shells: args.shells,
      threads: args.threads,
    }),
    stopWorkspaceProcesses: stopWorkspaceProcessesFor({
      root: args.threadId,
      shells: args.shells,
      services: args.services,
      threads: args.threads,
      log: args.log,
      ids: args.ids,
    }),
    recordWorkspaceArrival: (arrival) =>
      recordWorkspaceArrival({
        threadId: args.threadId,
        ...arrival,
        log: args.log,
        threads: args.threads,
        ids: args.ids,
      }),
  }
}
