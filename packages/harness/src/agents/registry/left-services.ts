import type { ThreadId } from '@dltech/atlas-core'

import type { ServiceRegistryPort } from '../../services/service-registry-port'
import { labelOf } from './running-shell'

export function leftServicesOf({
  threadId,
  services,
}: {
  threadId: ThreadId
  services: ServiceRegistryPort
}): readonly string[] {
  return (services.runningFor?.({ threadId }) ?? []).map(labelOf)
}
