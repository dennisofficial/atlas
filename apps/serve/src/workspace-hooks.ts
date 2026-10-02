import {
  EKilledBy,
  EServiceStatus,
  EShellStatus,
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

export function stopWorkspaceProcessesFor(args: {
  root: ThreadId
  shells: Pick<ShellRegistryPort, 'listEverywhere' | 'kill' | 'awaitEndings' | 'drainNotifications'>
  services: Pick<ServiceRegistryPort, 'list' | 'stop' | 'awaitEndings' | 'drainNotifications'>
  threads: Pick<ThreadStorePort, 'spawned'>
  log: Pick<EventLogPort, 'append'>
  ids: Pick<IdPort, 'nextRunId'>
}): () => Promise<void> {
  const { shells, services } = args
  return async () => {
    const family = await familyThreadIdsOf({ root: args.root, threads: args.threads })
    const owned = shells
      .listEverywhere()
      .filter((shell) => shell.status === EShellStatus.Running && family.has(shell.threadId))
    for (const shell of owned) {
      shells.kill({ shellId: shell.shellId, by: EKilledBy.ContainerSwitch, threadId: shell.threadId })
    }
    for (const service of services.list()) {
      if (service.status === EServiceStatus.Running) {
        services.stop({ serviceId: service.serviceId, by: EKilledBy.ContainerSwitch })
      }
    }
    const stragglers = await Promise.all([
      ...[...new Set(owned.map((shell) => shell.threadId))].map((threadId) =>
        shells.awaitEndings({ threadId, ms: KILL_SETTLE_MS }),
      ),
      services.awaitEndings({ ms: STOP_SETTLE_MS }),
    ])
    const stillRunning =
      shells
        .listEverywhere()
        .filter((shell) => shell.status === EShellStatus.Running && family.has(shell.threadId))
        .length + services.list().filter((service) => service.status === EServiceStatus.Running).length
    if (stillRunning > 0 || stragglers.some((count) => count > 0)) {
      throw new Error(
        'background processes are still writing to the workspace, so it cannot be captured consistently',
      )
    }
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
}): Pick<ServeApp, 'stopWorkspaceProcesses' | 'recordWorkspaceArrival'> {
  return {
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
