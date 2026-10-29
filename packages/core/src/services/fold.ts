import { EServiceStatus, serviceFailed, type ServiceEnding } from './status'

export const SERVICE_CAP = 3

export type FoldableService = ServiceEnding & { serviceId: string }

export type ServiceFold<TService extends FoldableService> = {
  shown: readonly TService[]
  hidden: number
  hiddenFailed: boolean
}

export function foldServices<TService extends FoldableService>(args: {
  services: readonly TService[]
  cap?: number
}): ServiceFold<TService> {
  const cap = args.cap ?? SERVICE_CAP
  const settled = args.services.filter((service) => service.status !== EServiceStatus.Running)
  const spared = new Set(
    settled.slice(Math.max(0, settled.length - cap)).map((service) => service.serviceId),
  )

  const shown: TService[] = []
  const hidden: TService[] = []

  for (const service of args.services) {
    if (service.status === EServiceStatus.Running || spared.has(service.serviceId)) {
      shown.push(service)
      continue
    }

    hidden.push(service)
  }

  return {
    shown,
    hidden: hidden.length,
    hiddenFailed: hidden.some((service) => serviceFailed(service)),
  }
}
