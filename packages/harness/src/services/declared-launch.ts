import { isAbsolute, join } from 'node:path'

import {
  declarationHash,
  declaredLinks,
  EServiceStatus,
  interpolateServiceEnv,
  internalServiceUrl,
  resolveLinks,
  serviceEnv,
  type DeclaredServiceLink,
  type PortExposure,
  type ProcessPort,
  type ResolvedServiceReference,
  type ThreadId,
} from '@dltech/atlas-core'

import { loadDeclaredServices, type DeclaredService } from './declared-services'
import { awaitReady, probeService, type ReadyTiming } from './service-health'
import type { ServiceSnapshot } from './service-process'
import type { ServiceRegistryPort } from './service-registry-port'
import { allocateServicePort, processPortProbe } from './service-port'

export type DeclaredEnsureOptions = {
  load?: typeof loadDeclaredServices | undefined
  timing?: ReadyTiming | undefined
}

export type DeclaredContext = {
  services: ServiceRegistryPort
  processes: ProcessPort
  root: string
  threadId: ThreadId
  options: DeclaredEnsureOptions | undefined
}

export type DeclaredLaunch =
  | {
      ok: true
      snapshot: ServiceSnapshot
      port: number
      exposure: PortExposure | undefined
      reason: string | undefined
    }
  | { ok: false; reason: string }

export function hashOfDeclared(declared: DeclaredService): string {
  const { name: _name, ...declaration } = declared
  return declarationHash(declaration)
}

export function linksOf({
  declared,
  publicUrl,
}: {
  declared: DeclaredService
  publicUrl: string | undefined
}): DeclaredServiceLink[] {
  if (publicUrl === undefined) return []
  return resolveLinks({ links: declaredLinks(declared), publicUrl })
}

export function resolvedFromRunning({
  services,
}: {
  services: ServiceRegistryPort
}): Record<string, ResolvedServiceReference> {
  const resolved: Record<string, ResolvedServiceReference> = {}
  for (const one of services.list()) {
    if (one.name === undefined || one.port === undefined) continue
    if (one.status !== EServiceStatus.Running) continue
    resolved[one.name] = {
      url: internalServiceUrl({ port: one.port }),
      publicUrl: one.exposure?.url,
      port: one.port,
    }
  }
  return resolved
}

async function exposureFor({
  declared,
  port,
  context,
}: {
  declared: DeclaredService
  port: number
  context: DeclaredContext
}): Promise<{ exposure?: PortExposure | undefined; reason?: string | undefined }> {
  if (declared.portal === undefined) return {}
  const { exposePort } = context.processes
  if (exposePort === undefined) return { reason: 'this session cannot publish a public URL' }

  const outcome = await exposePort.call(context.processes, {
    containerPort: port,
    threadId: context.threadId,
  })
  return outcome.ok ? { exposure: outcome.exposure } : { reason: outcome.reason }
}

export async function readinessOf({
  declared,
  port,
  context,
}: {
  declared: DeclaredService
  port: number
  context: DeclaredContext
}): Promise<{ ready: boolean; reason?: string | undefined }> {
  const verdict = await awaitReady({
    probe: () =>
      probeService({
        processes: context.processes,
        threadId: context.threadId,
        port,
        health: declared.health,
      }),
    alive: () =>
      context.services
        .list()
        .some((one) => one.name === declared.name && one.status === EServiceStatus.Running),
    timing: context.options?.timing,
  })
  return verdict.ready ? { ready: true } : { ready: false, reason: verdict.reason }
}

export function cwdOf({ declared, root }: { declared: DeclaredService; root: string }): string {
  if (declared.cwd === undefined) return root
  return isAbsolute(declared.cwd) ? declared.cwd : join(root, declared.cwd)
}

export async function launchDeclared({
  declared,
  context,
}: {
  declared: DeclaredService
  context: DeclaredContext
}): Promise<DeclaredLaunch> {
  const { services, threadId, root } = context
  const port = await allocateServicePort({
    threadId,
    name: declared.name,
    declared: declared.port,
    isFree: processPortProbe({ processes: context.processes }),
  })
  const published = await exposureFor({ declared, port, context })
  const started = await services.start({
    threadId,
    name: declared.name,
    port,
    command: declared.command,
    description: `declared service ${declared.name}`,
    cwd: cwdOf({ declared, root }),
    exposure: published.exposure,
    declarationHash: hashOfDeclared(declared),
    env: {
      ...interpolateServiceEnv({
        env: declared.env ?? {},
        resolved: resolvedFromRunning({ services }),
      }),
      ...serviceEnv({ port, threadId, publicUrl: published.exposure?.url }),
    },
  })
  if (!started.ok) return started
  return {
    ok: true,
    snapshot: started.snapshot,
    port,
    exposure: published.exposure,
    reason: published.reason,
  }
}
