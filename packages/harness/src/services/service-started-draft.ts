import type { EventDraft } from '@dltech/atlas-core'

import { bootId } from './boot'
import type { ServiceStartArgs } from './service-registry-port'

export function startedDraftOf({
  serviceId,
  args,
}: {
  serviceId: string
  args: ServiceStartArgs
}): EventDraft {
  return {
    type: 'service-started',
    serviceId,
    command: args.command,
    description: args.description,
    ...(args.name === undefined ? {} : { name: args.name }),
    ...(args.port === undefined ? {} : { port: args.port }),
    ...(args.declarationHash === undefined ? {} : { declarationHash: args.declarationHash }),
    bootId,
  }
}
