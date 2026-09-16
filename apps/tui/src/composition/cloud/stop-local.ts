import { EKilledBy, EServiceStatus, type ThreadId } from '@dltech/atlas-core'
import type { ServiceRegistryPort, ShellRegistryPort, ShellSnapshot } from '@dltech/atlas-harness'

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
export function stopLocalWork(args: {
  threadId: ThreadId
  shells: ShellRegistryPort
  services: ServiceRegistryPort
}): StoppedLocally {
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

  return { shells: running.map(labelOf), services }
}
