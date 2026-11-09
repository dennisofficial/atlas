import { pluginViewOf } from '@dltech/atlas-client/stream'
import type { ClientSlot } from '@dltech/atlas-plugin-sdk'

import { EServiceStatus } from '@dltech/atlas-core'

import { SERVICES_VIEW, servicesViewSchema, type ServiceRow } from '../core'

export { servicesCoreSlots } from '../core'

export const servicesClient: ClientSlot = {
  hooks: [
    {
      name: 'services-roster',
      appliesTo: (event) => event.type.startsWith('service-'),
    },
  ],
}

export const servicesOfView = (views: Readonly<Record<string, unknown>>): readonly ServiceRow[] =>
  pluginViewOf({
    views,
    name: SERVICES_VIEW,
    schema: servicesViewSchema,
  }) ?? []

export type PreviewItem = {
  serviceId: string
  label: string
  port: number
  url: string
}

const MAX_LABEL = 28

const labelOf = (row: ServiceRow): string => {
  const text = (row.name ?? row.command).trim()
  return text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL - 1)}…` : text
}

type Candidate = { item: PreviewItem; changedAt: string }

const candidateOf = (row: ServiceRow): Candidate | null => {
  if (row.status !== EServiceStatus.Running) return null
  if (row.url === undefined || row.port === undefined) return null
  return {
    changedAt: row.changedAt,
    item: {
      serviceId: row.serviceId,
      label: labelOf(row),
      port: row.port,
      url: row.url,
    },
  }
}

const newer = (next: Candidate, kept: Candidate): Candidate =>
  next.changedAt > kept.changedAt ? next : kept

export const previewsOfView = (
  views: Readonly<Record<string, unknown>>,
): readonly PreviewItem[] => {
  const byPort = new Map<number, Candidate>()
  for (const row of servicesOfView(views)) {
    const candidate = candidateOf(row)
    if (candidate === null) continue
    const kept = byPort.get(candidate.item.port)
    byPort.set(candidate.item.port, kept === undefined ? candidate : newer(candidate, kept))
  }
  return [...byPort.values()].map(({ item }) => item).sort((left, right) => left.port - right.port)
}
