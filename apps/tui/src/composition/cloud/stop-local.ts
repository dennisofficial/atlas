import { EKilledBy, EServiceStatus, type ThreadId } from '@dltech/atlas-core'
import {
  KILL_SETTLE_MS,
  STOP_SETTLE_MS,
  type ServiceRegistryPort,
  type ShellRegistryPort,
  type ShellSnapshot,
} from '@dltech/atlas-harness'

import { isShellRunning } from '../../ui/shells-model'
import type { StoppedLocally } from './transition-notice'

const labelOf = (one: { command: string; description?: string | undefined }): string => {
  const described = one.description ?? ''
  return described.length === 0 ? one.command : described
}

/**
 * Nothing local survives a lift: the shells and services were processes on this machine, and the
 * conversation is about to continue on another one. What they were is kept so the move can be
 * narrated rather than silently swallowing them.
 */
export async function stopLocalWork(args: {
  threadId: ThreadId
  shells: ShellRegistryPort
  services: ServiceRegistryPort
}): Promise<StoppedLocally> {
  const running: readonly ShellSnapshot[] = args.shells
    .list({ threadId: args.threadId })
    .filter(isShellRunning)

  for (const shell of running) {
    args.shells.kill({
      shellId: shell.shellId,
      by: EKilledBy.ContainerSwitch,
      threadId: args.threadId,
    })
  }
  const shellEndings = args.shells.awaitEndings({ threadId: args.threadId, ms: KILL_SETTLE_MS })

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

  await Promise.all([shellEndings, serviceEndings])

  return {
    shells: running.map(labelOf),
    services,
    drainNotices: () => [
      ...args.shells.drainNotifications({ threadId: args.threadId }),
      ...args.services.drainNotifications({ threadId: args.threadId }),
    ],
  }
}
