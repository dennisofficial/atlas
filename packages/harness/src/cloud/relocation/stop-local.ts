import { EKilledBy, EServiceStatus, type ThreadId } from '@dltech/atlas-core'

import type { ThreadStorePort } from '../../store/thread-store'
import { KILL_SETTLE_MS, type ShellRegistryPort } from '../../shells/shell-registry'
import { STOP_SETTLE_MS, type ServiceRegistryPort } from '../../services/service-registry'
import type { StoppedLocally } from './transition-notice'

const labelOf = (one: { command: string; description?: string | undefined }): string => {
  const described = one.description ?? ''
  return described.length === 0 ? one.command : described
}

const familyOf = async (args: {
  root: ThreadId
  threads: Pick<ThreadStorePort, 'spawned'>
}): Promise<readonly ThreadId[]> => {
  const family = [args.root]
  for (const threadId of family) {
    for (const child of await args.threads.spawned({ threadId })) {
      if (!family.includes(child.id)) family.push(child.id)
    }
  }
  return family
}

export async function stopLocalWork(args: {
  threadId: ThreadId
  shells: ShellRegistryPort
  services: ServiceRegistryPort
  threads: Pick<ThreadStorePort, 'spawned'>
}): Promise<StoppedLocally> {
  const family = await familyOf({ root: args.threadId, threads: args.threads })
  const shellEndings = args.shells.stopOwners({
    threadIds: family,
    by: EKilledBy.ContainerSwitch,
    ms: KILL_SETTLE_MS,
  })

  const services = args.services
    .list()
    .filter((service) => service.status === EServiceStatus.Running)
    .flatMap((service) => {
      const stopped = args.services.stop({
        serviceId: service.serviceId,
        by: EKilledBy.ContainerSwitch,
      })
      return stopped.ok ? [labelOf(service)] : []
    })
  const serviceEndings = args.services.awaitEndings({ ms: STOP_SETTLE_MS })

  const [running] = await Promise.all([shellEndings, serviceEndings])

  return {
    shells: running.map(labelOf),
    services,
    drainNotices: () =>
      family.flatMap((threadId) => [
        ...args.shells.drainNotifications({ threadId }),
        ...args.services.drainNotifications({ threadId }),
      ]),
  }
}
