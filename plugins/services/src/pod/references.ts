import {
  EServiceReferenceField,
  internalServiceUrl,
  serviceReferencesOf,
  type ResolvedServiceReference,
  type ServiceDeclaration,
} from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { referencesAt, servicesOfEvents, type DeclaredServices } from '../core'
import { exposeService } from './expose'
import { allocatePort, type DeclaredPlace } from './place'

export const forwardReferences = async (args: {
  ctx: PluginPodContext
  declared: DeclaredServices
  declaration: ServiceDeclaration
  place: DeclaredPlace
  signal?: AbortSignal | undefined
}): Promise<Record<string, ResolvedServiceReference>> => {
  const rows = servicesOfEvents(args.ctx.events())
  const resolved = referencesAt({ rows, root: args.place.root })
  for (const { target, field } of serviceReferencesOf(args.declaration.env)) {
    if (field !== EServiceReferenceField.PublicUrl || resolved[target] !== undefined) continue
    const declaredTarget = args.declared.services.get(target)
    if (declaredTarget?.portal === undefined) continue
    const port = await allocatePort({
      ctx: args.ctx,
      rows,
      name: target,
      root: args.place.root,
      declared: declaredTarget.port,
      signal: args.signal,
    })
    if (port === undefined) continue
    const exposure = await exposeService({ ctx: args.ctx, port })
    if (!exposure.ok) continue
    resolved[target] = { url: internalServiceUrl({ port }), port, publicUrl: exposure.url }
  }
  return resolved
}
