import { randomBytes } from 'node:crypto'

import { CHANNEL_PROTOCOL_VERSION, SANDBOX_SERVE_PORT, UNSTAMPED_PROTOCOL } from '@dltech/atlas-wire'

import { EngineRequestFailed, type DockerEngine } from '../../execution/docker/engine'
import type { DockerPodEngine, PodDetails } from '../../execution/docker/pod-engine'
import type { PodPlacement, PodProvisionArgs, RunnerPodHandle } from '../runner-driver'
import { ensurePodIngress, POD_INGRESS_CONTAINER_PORT } from './ingress'
import {
  dindVolumeNameOf,
  podCreateBody,
  podNameFor,
  podRoleLabel,
  podThreadLabel,
  POD_ROLE,
  workspaceVolumeNameOf,
} from './pod-create'
import { isPodStaged, stagePod } from './pod-staged'
import type { PodServeLauncher } from './serve-launch'

export type PodDriverEngine = Pick<DockerEngine, 'listContainers' | 'createContainer'> &
  Pick<
    DockerPodEngine,
    | 'inspectPod'
    | 'startPod'
    | 'removePod'
    | 'createVolume'
    | 'removeVolume'
    | 'updateContainer'
    | 'writeFile'
    | 'execSh'
  >

export type PodHostPorts = { serveHostPort: number; ingressHostPort: number }

export type PodProvisionDeps = {
  engine: PodDriverEngine
  image: string
  vcpus: number
  cloudUrl: string
  hostPorts: (args: { threadId: string }) => PodHostPorts
  launchServe: PodServeLauncher
  desiredVersion: string | undefined
  log: ((line: string) => void) | undefined
}

type Located = { id: string; created: boolean; token: string }

const CONFLICT = 409

const isConflict = (failure: unknown): boolean =>
  failure instanceof EngineRequestFailed && failure.status === CONFLICT

const describeFailure = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

const hostPortOf = (args: { pod: PodDetails; containerPort: number; what: string }): number => {
  const bound = args.pod.ports.find((port) => port.containerPort === args.containerPort)
  if (bound === undefined) throw new Error(`pod ${args.pod.name} publishes no host port for ${args.what}`)
  return bound.hostPort
}

const findPod = async (args: { deps: PodProvisionDeps; threadId: string }): Promise<string | undefined> => {
  const found = await args.deps.engine.listContainers({
    labels: { [podThreadLabel]: args.threadId },
    all: true,
  })
  return found[0]?.id
}

const removeVolumes = async (args: { deps: PodProvisionDeps; name: string }): Promise<void> => {
  const volumes = [workspaceVolumeNameOf({ podName: args.name }), dindVolumeNameOf({ podName: args.name })]
  for (const volume of volumes) {
    await args.deps.engine.removeVolume({ name: volume }).catch((failure: unknown) => {
      args.deps.log?.(`rollback could not remove volume ${volume}: ${describeFailure(failure)}`)
    })
  }
}

const rollback = async (args: { deps: PodProvisionDeps; name: string; id: string | undefined }): Promise<void> => {
  if (args.id !== undefined) {
    await args.deps.engine.removePod({ id: args.id }).catch((failure: unknown) => {
      args.deps.log?.(`rollback could not remove pod ${args.name}: ${describeFailure(failure)}`)
    })
  }
  await removeVolumes(args)
  args.deps.log?.(`rolled back the half-built pod ${args.name}`)
}

const discardPartialBirth = async (args: { deps: PodProvisionDeps; name: string }): Promise<void> => {
  const stray = await args.deps.engine.inspectPod({ id: args.name }).catch((failure: unknown) => {
    args.deps.log?.(`could not look for a stray pod ${args.name}: ${describeFailure(failure)}`)
    return undefined
  })
  if (stray !== undefined) {
    await args.deps.engine.removePod({ id: stray.id }).catch((failure: unknown) => {
      args.deps.log?.(`could not remove stray pod ${args.name}: ${describeFailure(failure)}`)
    })
  }
  await removeVolumes(args)
}

const createFresh = async (args: {
  deps: PodProvisionDeps
  provision: PodProvisionArgs<RunnerPodHandle>
  token: string
}): Promise<string | undefined> => {
  const { deps, provision } = args
  const labels = { [podThreadLabel]: provision.threadId, [podRoleLabel]: POD_ROLE }
  const ports = deps.hostPorts({ threadId: provision.threadId })

  try {
    await deps.engine.createVolume({ name: workspaceVolumeNameOf({ podName: provision.name }), labels })
    await deps.engine.createVolume({ name: dindVolumeNameOf({ podName: provision.name }), labels })
    const created = await deps.engine.createContainer({
      name: provision.name,
      body: podCreateBody({
        threadId: provision.threadId,
        image: deps.image,
        ...ports,
        vcpus: deps.vcpus,
        token: args.token,
        cloudUrl: deps.cloudUrl,
        pinnedModel: provision.pinnedModel,
        environment: provision.environment ?? {},
      }),
    })
    return created.id
  } catch (failure) {
    if (isConflict(failure)) return undefined
    await discardPartialBirth({ deps, name: provision.name })
    throw failure
  }
}

const locate = async (args: {
  deps: PodProvisionDeps
  provision: PodProvisionArgs<RunnerPodHandle>
}): Promise<Located> => {
  const { deps, provision } = args
  const resumedToken = (): string => {
    if (provision.token === undefined) {
      throw new Error(`resuming pod ${provision.name} needs the serve token the caller minted for it`)
    }
    return provision.token
  }

  const existing = await findPod({ deps, threadId: provision.threadId })
  if (existing !== undefined) return { id: existing, created: false, token: resumedToken() }

  const token = provision.token ?? randomBytes(32).toString('hex')
  const createdId = await createFresh({ deps, provision, token })
  if (createdId !== undefined) return { id: createdId, created: true, token }

  const winner = await findPod({ deps, threadId: provision.threadId })
  if (winner === undefined) throw new Error(`pod ${provision.name} already exists but cannot be found`)
  return { id: winner, created: false, token: resumedToken() }
}

const boot = async (args: {
  deps: PodProvisionDeps
  provision: PodProvisionArgs<RunnerPodHandle>
  located: Located
}): Promise<PodPlacement> => {
  const { deps, provision, located } = args
  await deps.engine.startPod({ id: located.id })

  const pod = await deps.engine.inspectPod({ id: located.id })
  if (pod === undefined) throw new Error(`pod ${provision.name} vanished while starting`)
  const serveHostPort = hostPortOf({ pod, containerPort: SANDBOX_SERVE_PORT, what: 'serve' })
  const ingressHostPort = hostPortOf({ pod, containerPort: POD_INGRESS_CONTAINER_PORT, what: 'the ingress' })

  await ensurePodIngress({ engine: deps.engine, id: located.id, ingressHostPort })
  const needsStaging =
    located.created || !(await isPodStaged({ engine: deps.engine, id: located.id, name: provision.name }))
  if (needsStaging) {
    await stagePod({
      engine: deps.engine,
      id: located.id,
      name: provision.name,
      putContext: provision.putContextOnFreshBoot,
    })
  }

  const { swapped } = await deps.launchServe({
    engine: deps.engine,
    id: located.id,
    name: provision.name,
    token: located.token,
    cloudUrl: deps.cloudUrl,
    desiredVersion: deps.desiredVersion,
    onSwapStarted: provision.onRotationStarted,
  })

  const rotatedProtocol =
    swapped !== undefined &&
    swapped.fromProtocol !== UNSTAMPED_PROTOCOL &&
    swapped.fromProtocol !== CHANNEL_PROTOCOL_VERSION
      ? swapped.fromProtocol
      : undefined

  return {
    url: `http://127.0.0.1:${serveHostPort}`,
    state: 'running',
    created: needsStaging,
    token: located.token,
    ...(deps.desiredVersion === undefined ? {} : { serveVersion: deps.desiredVersion }),
    ...(swapped?.fromVersion === undefined ? {} : { rotatedFrom: swapped.fromVersion }),
    ...(rotatedProtocol === undefined ? {} : { rotatedProtocol }),
  }
}

export function assertPodNameBelongs(args: { name: string; threadId: string }): void {
  if (args.name !== podNameFor({ threadId: args.threadId })) {
    throw new Error(`pod name ${args.name} does not belong to thread ${args.threadId}`)
  }
}

export async function provisionPod(args: {
  deps: PodProvisionDeps
  provision: PodProvisionArgs<RunnerPodHandle>
}): Promise<PodPlacement> {
  const located = await locate(args)
  try {
    return await boot({ ...args, located })
  } catch (failure) {
    if (located.created) {
      await rollback({ deps: args.deps, name: args.provision.name, id: located.id })
    }
    throw failure
  }
}
