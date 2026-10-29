import { join, isAbsolute } from 'node:path'

import {
  EServiceStatus,
  serviceEnv,
  type PortExposure,
  type ProcessPort,
  type ThreadId,
} from '@dltech/atlas-core'

import { loadDeclaredServices, type DeclaredService } from './declared-services'
import { awaitReady, probeService, type ReadyTiming } from './service-health'
import type { ServiceSnapshot } from './service-process'
import type { ServiceRegistryPort } from './service-registry-port'
import { allocateServicePort, processPortProbe } from './service-port'

export enum EEnsureStatus {
  Started = 'started',
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
  ready: boolean
  reason?: string | undefined
}

export type DeclaredEnsureOptions = {
  load?: typeof loadDeclaredServices | undefined
  timing?: ReadyTiming | undefined
}

type EnsureContext = {
  services: ServiceRegistryPort
  processes: ProcessPort
  root: string
  threadId: ThreadId
  options: DeclaredEnsureOptions | undefined
}

const liveEntryFor = ({
  services,
  name,
}: {
  services: ServiceRegistryPort
  name: string
}): ServiceSnapshot | undefined =>
  services.list().find((one) => one.name === name && one.status === EServiceStatus.Running)

async function exposureFor({
  declared,
  port,
  context,
}: {
  declared: DeclaredService
  port: number
  context: EnsureContext
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

async function readinessOf({
  declared,
  port,
  context,
}: {
  declared: DeclaredService
  port: number
  context: EnsureContext
}): Promise<Pick<EnsuredService, 'ready' | 'reason'>> {
  const verdict = await awaitReady({
    probe: () =>
      probeService({
        processes: context.processes,
        threadId: context.threadId,
        port,
        health: declared.health,
      }),
    alive: () => liveEntryFor({ services: context.services, name: declared.name }) !== undefined,
    timing: context.options?.timing,
  })
  return verdict.ready ? { ready: true } : { ready: false, reason: verdict.reason }
}

async function ensureOne({
  declared,
  context,
}: {
  declared: DeclaredService
  context: EnsureContext
}): Promise<EnsuredService> {
  const { services, threadId, root } = context
  const running = liveEntryFor({ services, name: declared.name })
  if (running !== undefined) {
    const port = running.port ?? declared.port
    const ready =
      port === undefined ? { ready: true } : await readinessOf({ declared, port, context })
    return {
      name: declared.name,
      status: EEnsureStatus.Running,
      url: running.exposure?.url,
      ...ready,
    }
  }

  if (services.crashLooping?.({ name: declared.name }) === true) {
    return {
      name: declared.name,
      status: EEnsureStatus.CrashLooping,
      ready: false,
      reason: 'it kept crashing and was given up on; call service_restart to try again',
    }
  }

  const port = await allocateServicePort({
    threadId,
    name: declared.name,
    declared: declared.port,
    isFree: processPortProbe({ processes: context.processes }),
  })
  const published = await exposureFor({ declared, port, context })
  const cwd =
    declared.cwd === undefined
      ? root
      : isAbsolute(declared.cwd)
        ? declared.cwd
        : join(root, declared.cwd)

  const started = await services.start({
    threadId,
    name: declared.name,
    port,
    command: declared.command,
    description: `declared service ${declared.name}`,
    cwd,
    exposure: published.exposure,
    env: {
      ...declared.env,
      ...serviceEnv({ port, threadId, publicUrl: published.exposure?.url }),
    },
  })
  if (!started.ok) {
    return {
      name: declared.name,
      status: EEnsureStatus.Failed,
      ready: false,
      reason: started.reason,
    }
  }
  if (started.snapshot.status !== EServiceStatus.Running) {
    return {
      name: declared.name,
      status: EEnsureStatus.Failed,
      url: published.exposure?.url,
      ready: false,
      reason: 'it exited before it settled; read its log',
    }
  }

  const ready = await readinessOf({ declared, port, context })
  return {
    name: declared.name,
    status: EEnsureStatus.Started,
    url: published.exposure?.url,
    ready: ready.ready,
    reason: ready.reason ?? published.reason,
  }
}

export async function ensureDeclaredServices({
  threadId,
  names,
  services,
  processes,
  root,
  inflight,
  options,
}: {
  threadId: ThreadId
  names?: readonly string[] | undefined
  services: ServiceRegistryPort
  processes: ProcessPort
  root: string
  inflight: Map<string, Promise<EnsuredService>>
  options?: DeclaredEnsureOptions | undefined
}): Promise<readonly EnsuredService[]> {
  const read = await (options?.load ?? loadDeclaredServices)({ root })
  const context: EnsureContext = { services, processes, root, threadId, options }
  const results: EnsuredService[] = read.rejections.map((rejection) => ({
    name: rejection.name ?? '.atlas/services.yaml',
    status: EEnsureStatus.Invalid,
    ready: false,
    reason: rejection.detail,
  }))

  const wanted =
    names === undefined ? read.services : read.services.filter((one) => names.includes(one.name))
  for (const name of names ?? []) {
    if (read.services.some((one) => one.name === name)) continue
    results.push({
      name,
      status: EEnsureStatus.Unknown,
      ready: false,
      reason: `not declared; declared services: ${read.services.map((one) => one.name).join(', ') || 'none'}`,
    })
  }

  const ensured: EnsuredService[] = []
  for (const declared of wanted) {
    const held = inflight.get(declared.name)
    const work = held ?? ensureOne({ declared, context })
    if (held === undefined) {
      inflight.set(declared.name, work)
      void work.then(
        () => inflight.delete(declared.name),
        () => inflight.delete(declared.name),
      )
    }
    ensured.push(await work)
  }
  return [...ensured, ...results]
}
