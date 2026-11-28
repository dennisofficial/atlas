import { EServiceStatus } from '@dltech/atlas-core'
import type { ServiceRow as ServiceViewRow } from '@dltech/atlas-plugin-services/core'
import type { PreviewItem } from '@dltech/atlas-plugin-services/client'

import { buildServiceRows, type ServiceRow } from '../ui/services-model'

export type DrawerService = {
  serviceId: string
  command: string
  description: string
  status: EServiceStatus
  startedAt: string
  endedAt?: string | undefined
  name?: string | undefined
  port?: number | undefined
  url?: string | undefined
  exposure?: { containerPort: number; hostPort: number; url: string } | undefined
}

const exposureOf = (
  row: ServiceViewRow,
): { containerPort: number; hostPort: number; url: string } | undefined => {
  if (row.port === undefined || row.url === undefined) return undefined
  return { containerPort: row.port, hostPort: row.port, url: row.url }
}

export const drawerServicesOf = (rows: readonly ServiceViewRow[]): readonly DrawerService[] =>
  rows.map((row) => ({
    serviceId: row.serviceId,
    command: row.command,
    description: row.name?.trim() || row.command.trim() || row.serviceId,
    status: row.status,
    startedAt: row.changedAt,
    ...(row.name === undefined ? {} : { name: row.name }),
    ...(row.port === undefined ? {} : { port: row.port }),
    ...(row.url === undefined ? {} : { url: row.url }),
    ...(exposureOf(row) === undefined ? {} : { exposure: exposureOf(row) }),
  }))

/**
 * v2 has no declared services, so every row is a runtime one: the key is its service id and the
 * name falls back to the command. The log path is not carried either, so the drawer says it has
 * printed nothing rather than pointing at a file it cannot read.
 */
export const serviceRowsOf = (args: {
  services: readonly DrawerService[]
  previews: readonly PreviewItem[]
}): readonly ServiceRow[] =>
  buildServiceRows({
    declared: null,
    services: args.services.map((row) => ({
      serviceId: row.serviceId,
      command: row.command,
      description: row.description,
      status: row.status,
      startedAt: row.startedAt,
      logPath: '',
      ...(row.endedAt === undefined ? {} : { endedAt: row.endedAt }),
      ...(row.name === undefined ? {} : { name: row.name }),
      ...(row.port === undefined ? {} : { port: row.port }),
      ...(row.exposure === undefined ? {} : { exposure: row.exposure }),
    })),
  })

export const serviceFoldOf = (
  services: readonly DrawerService[],
): { hidden: number; hiddenFailed: boolean } => {
  const settled = services.filter((row) => row.status !== EServiceStatus.Running)
  return {
    hidden: settled.length,
    hiddenFailed: settled.some((row) => row.status !== EServiceStatus.Exited),
  }
}
