import {
  EServiceReferenceField,
  internalServiceUrl,
  serviceReferencesOf,
  type ResolvedServiceReference,
} from '@dltech/atlas-core'

import { exposureFor, resolvedFromRunning, type DeclaredContext } from './declared-launch'
import type { DeclaredService } from './declared-services'
import { allocateServicePort, processPortProbe } from './service-port'

async function unpublishedReference({
  target,
  context,
}: {
  target: DeclaredService
  context: DeclaredContext
}): Promise<ResolvedServiceReference | undefined> {
  const port = await allocateServicePort({
    threadId: context.threadId,
    name: target.name,
    declared: target.port,
    isFree: processPortProbe({ processes: context.processes }),
  })
  const published = await exposureFor({ declared: target, port, context })
  if (published.exposure === undefined) return undefined
  return { url: internalServiceUrl({ port }), port, publicUrl: published.exposure.url }
}

export async function resolvedReferences({
  declared,
  context,
}: {
  declared: DeclaredService
  context: DeclaredContext
}): Promise<Record<string, ResolvedServiceReference>> {
  const resolved = resolvedFromRunning({ services: context.services })
  for (const { target, field } of serviceReferencesOf(declared.env)) {
    if (field !== EServiceReferenceField.PublicUrl || resolved[target] !== undefined) continue
    const declaredTarget = context.declaredServices.find((one) => one.name === target)
    if (declaredTarget === undefined || declaredTarget.portal === undefined) continue
    const reference = await unpublishedReference({ target: declaredTarget, context })
    if (reference !== undefined) resolved[target] = reference
  }
  return resolved
}
