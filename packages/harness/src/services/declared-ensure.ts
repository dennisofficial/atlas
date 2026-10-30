import {
  EKilledBy,
  EServiceStatus,
  orderDeclaredServices,
  serviceReferencesOf,
  type DeclaredServiceLink,
  type ProcessPort,
  type ThreadId,
} from '@dltech/atlas-core'

import {
  hashOfDeclared,
  launchDeclared,
  linksOf,
  readinessOf,
  type DeclaredContext,
  type DeclaredEnsureOptions,
} from './declared-launch'
import { runSetup } from './declared-setup'
import { loadDeclaredServices, type DeclaredService } from './declared-services'
import type { ServiceRegistryPort } from './service-registry-port'

export type { DeclaredEnsureOptions } from './declared-launch'

export enum EEnsureStatus {
  Started = 'started',
  Restarted = 'restarted',
  Running = 'running',
  Failed = 'failed',
  CrashLooping = 'crash-looping',
  Unknown = 'unknown',
  Invalid = 'invalid',
}

export type EnsuredService = {
  name: string
  status: EEnsureStatus
  url?: string | undefined
  links: readonly DeclaredServiceLink[]
  ready: boolean
  reason?: string | undefined
}

const STOP_WAIT_MS = 5_000
const STOP_POLL_MS = 10

const BROKEN: ReadonlySet<EEnsureStatus> = new Set([
  EEnsureStatus.Failed,
  EEnsureStatus.CrashLooping,
  EEnsureStatus.Invalid,
])

export async function stopAndWait({
  services,
  serviceId,
  by,
}: {
  services: ServiceRegistryPort
  serviceId: string
  by: Parameters<ServiceRegistryPort['stop']>[0]['by']
}): Promise<void> {
  await services.stop({ serviceId, by })
  const deadline = Date.now() + STOP_WAIT_MS
  while (Date.now() < deadline) {
    const one = services.list().find((item) => item.serviceId === serviceId)
    if (one === undefined || one.status !== EServiceStatus.Running) return
    await Bun.sleep(STOP_POLL_MS)
  }
}

export async function startDeclaredOnce({
  declared,
  context,
  setupDone,
  status,
}: {
  declared: DeclaredService
  context: DeclaredContext
  setupDone: Set<string>
  status: EEnsureStatus
}): Promise<EnsuredService> {
  const base = { name: declared.name, links: [] as DeclaredServiceLink[], ready: false }
  if (!setupDone.has(declared.name) && declared.setup !== undefined) {
    const failure = await runSetup({
      declared,
      context,
      spawn: context.processes.spawn,
      threadId: context.threadId,
    })
    if (failure !== undefined) return { ...base, status: EEnsureStatus.Failed, reason: failure }
  }
  setupDone.add(declared.name)

  const launched = await launchDeclared({ declared, context })
  if (!launched.ok) return { ...base, status: EEnsureStatus.Failed, reason: launched.reason }

  const url = launched.exposure?.url
  const links = linksOf({ declared, publicUrl: url })
  if (launched.snapshot.status !== EServiceStatus.Running) {
    return {
      ...base,
      status: EEnsureStatus.Failed,
      url,
      links,
      reason: 'it exited before it settled; read its log',
    }
  }

  const ready = await readinessOf({ declared, port: launched.port, context })
  return {
    name: declared.name,
    status,
    url,
    links,
    ready: ready.ready,
    reason: ready.reason ?? launched.reason,
  }
}

async function ensureOne({
  declared,
  context,
  setupDone,
}: {
  declared: DeclaredService
  context: DeclaredContext
  setupDone: Set<string>
}): Promise<EnsuredService> {
  const { services } = context
  const running = services
    .list()
    .find((one) => one.name === declared.name && one.status === EServiceStatus.Running)
  if (running !== undefined) {
    const stale =
      running.declarationHash !== undefined && running.declarationHash !== hashOfDeclared(declared)
    if (!stale) {
      const port = running.port ?? declared.port
      const ready =
        port === undefined ? { ready: true } : await readinessOf({ declared, port, context })
      const url = running.exposure?.url
      return {
        name: declared.name,
        status: EEnsureStatus.Running,
        url,
        links: linksOf({ declared, publicUrl: url }),
        ...ready,
      }
    }
    await stopAndWait({ services, serviceId: running.serviceId, by: EKilledBy.Model })
    return startDeclaredOnce({ declared, context, setupDone, status: EEnsureStatus.Restarted })
  }

  if (services.crashLooping?.({ name: declared.name }) === true) {
    return {
      name: declared.name,
      status: EEnsureStatus.CrashLooping,
      links: [],
      ready: false,
      reason: 'it kept crashing and was given up on; call service_restart to try again',
    }
  }

  return startDeclaredOnce({ declared, context, setupDone, status: EEnsureStatus.Started })
}

export async function ensureDeclaredServices({
  threadId,
  names,
  services,
  processes,
  root,
  inflight,
  setupDone,
  options,
}: {
  threadId: ThreadId
  names?: readonly string[] | undefined
  services: ServiceRegistryPort
  processes: ProcessPort
  root: string
  inflight: Map<string, Promise<EnsuredService>>
  setupDone: Set<string>
  options?: DeclaredEnsureOptions | undefined
}): Promise<readonly EnsuredService[]> {
  const read = await (options?.load ?? loadDeclaredServices)({ root })
  const context: DeclaredContext = { services, processes, root, threadId, options }
  const results: EnsuredService[] = read.rejections.map((rejection) => ({
    name: rejection.name ?? '.atlas/services.yaml',
    status: EEnsureStatus.Invalid,
    links: [],
    ready: false,
    reason: rejection.detail,
  }))

  const known = (names ?? read.services.map((one) => one.name)).filter((name) =>
    read.services.some((one) => one.name === name),
  )
  for (const name of names ?? []) {
    if (read.services.some((one) => one.name === name)) continue
    results.push({
      name,
      status: EEnsureStatus.Unknown,
      links: [],
      ready: false,
      reason: `not declared; declared services: ${read.services.map((one) => one.name).join(', ') || 'none'}`,
    })
  }

  const ordering = orderDeclaredServices({ services: read.services, wanted: known })
  if (!ordering.ok) {
    return [
      ...ordering.problems.map((problem) => ({
        name: problem.name,
        status: EEnsureStatus.Invalid,
        links: [],
        ready: false,
        reason: problem.detail,
      })),
      ...results,
    ]
  }

  const ensured = new Map<string, EnsuredService>()
  for (const name of ordering.order) {
    const declared = read.services.find((one) => one.name === name)
    if (declared === undefined) continue
    const failedDependency = serviceReferencesOf(declared.env)
      .map((reference) => reference.target)
      .find((target) => {
        const status = ensured.get(target)?.status
        return status !== undefined && BROKEN.has(status)
      })
    if (failedDependency !== undefined) {
      ensured.set(name, {
        name,
        status: EEnsureStatus.Failed,
        links: [],
        ready: false,
        reason: `depends on ${failedDependency}, which failed`,
      })
      continue
    }

    const held = inflight.get(name)
    const work = held ?? ensureOne({ declared, context, setupDone })
    if (held === undefined) {
      inflight.set(name, work)
      void work.then(
        () => inflight.delete(name),
        () => inflight.delete(name),
      )
    }
    ensured.set(name, await work)
  }
  return [...ensured.values(), ...results]
}
