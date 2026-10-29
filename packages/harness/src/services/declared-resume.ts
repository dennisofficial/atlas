import type { EventLogPort, ThreadId } from '@dltech/atlas-core'

import type { EnsuredService } from './declared-ensure'
import { declaredServicesToResume } from './service-resume'
import type { ServiceRegistryPort } from './service-registry-port'

export async function resumeDeclaredServices({
  services,
  log,
  threadId,
}: {
  services: Pick<ServiceRegistryPort, 'ensureDeclared'>
  log: Pick<EventLogPort, 'readOwn'>
  threadId: ThreadId
}): Promise<readonly EnsuredService[]> {
  if (services.ensureDeclared === undefined) return []

  const names = declaredServicesToResume({ events: await log.readOwn({ threadId }) })
  if (names.length === 0) return []

  return services.ensureDeclared({ threadId, names })
}
