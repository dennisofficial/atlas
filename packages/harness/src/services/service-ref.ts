import { EServiceStatus } from '@dltech/atlas-core'

import type { ServiceSnapshot } from './service-process'

export function resolveServiceRef({
  services,
  ref,
}: {
  services: readonly ServiceSnapshot[]
  ref: string
}): ServiceSnapshot | undefined {
  const byId = services.find((service) => service.serviceId === ref)
  if (byId !== undefined) return byId

  const named = services.filter((service) => service.name === ref)
  return (
    named.find((service) => service.status === EServiceStatus.Running) ?? named[named.length - 1]
  )
}
