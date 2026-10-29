import { logTail } from './service-process'
import type { ServiceRegistryPort } from './service-registry-port'

export const serviceLogTail = (args: {
  services: Pick<ServiceRegistryPort, 'list'>
  serviceId: string
  characters: number
}): string => {
  const found = args.services.list().find((one) => one.serviceId === args.serviceId)
  if (found === undefined) return ''
  return logTail({ path: found.logPath, characters: args.characters })
}
