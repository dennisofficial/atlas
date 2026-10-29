import { posix } from 'node:path'

import {
  SANDBOX_SERVE_PORT,
  type DevServeResolver,
  type SandboxStateWire,
} from '@dltech/atlas-wire'

import { DockerEngine } from '../../execution/docker/engine'
import { DockerPodEngine } from '../../execution/docker/pod-engine'
import type {
  PodObservation,
  PodPlacement,
  PodProvisionArgs,
  RunnerDriver,
  RunnerPodHandle,
} from '../runner-driver'
import {
  assertPodNameBelongs,
  provisionPod,
  type PodDriverEngine,
  type PodHostPorts,
  type PodProvisionDeps,
} from './driver-provision'
import {
  DEFAULT_POD_IMAGE,
  dindVolumeNameOf,
  memoryReservationBytesFor,
  MIB,
  workspaceVolumeNameOf,
} from './pod-create'
import { hostPortFor } from './ports'
import { fileProvisionLock, type ProvisionLock } from './provision-lock'
import { boundedScript, shellQuoted } from './serve-exec'
import {
  devServeInstaller,
  podServeArchOf,
  releaseServeInstaller,
  type PodServeInstaller,
} from './serve-install'
import { createPodServeLauncher, type PodServeLauncher } from './serve-launch'

export type { PodDriverEngine } from './driver-provision'

export type PodDriverConfig = {
  image?: string | undefined
  socketPath?: string | undefined
  serveVersion?: string | undefined
  devServe?: DevServeResolver | undefined
  vcpus?: number | undefined
  cloudUrl: string
  home: string
  log?: ((line: string) => void) | undefined
}

type ServePlan = { launchServe: PodServeLauncher; version: string | undefined }

const DEFAULT_SOCKET_PATH = '/var/run/docker.sock'
const DEFAULT_VCPUS = 2
const NANO_CPUS_PER_VCPU = 1e9
const BOOTSTRAP_MKDIR_SECONDS = 20

const stateOf = (status: string): SandboxStateWire => {
  switch (status) {
    case 'running':
      return 'running'
    case 'restarting':
      return 'resuming'
    case 'created':
    case 'exited':
    case 'paused':
      return 'parked'
    case 'dead':
    case 'removing':
      return 'stopped'
    default:
      return 'unknown'
  }
}

const defaultHostPorts = (args: { threadId: string }): PodHostPorts => ({
  serveHostPort: hostPortFor({
    session: args.threadId,
    containerPort: SANDBOX_SERVE_PORT,
  }),
})

const dockerEngineAt = (socketPath: string): PodDriverEngine => {
  const docker = new DockerEngine({ socketPath })
  const pods = new DockerPodEngine({ socketPath })
  return {
    listContainers: (args) => docker.listContainers(args),
    createContainer: (args) => docker.createContainer(args),
    inspectPod: (args) => pods.inspectPod(args),
    startPod: (args) => pods.startPod(args),
    removePod: (args) => pods.removePod(args),
    createVolume: (args) => pods.createVolume(args),
    removeVolume: (args) => pods.removeVolume(args),
    updateContainer: (args) => pods.updateContainer(args),
    writeFile: (args) => pods.writeFile(args),
    execSh: (args) => pods.execSh(args),
  }
}

export class DockerPodDriver implements RunnerDriver {
  private readonly engine: PodDriverEngine
  private readonly inflightByName = new Map<string, Promise<unknown>>()
  private readonly injectedLaunch: PodServeLauncher | undefined
  private readonly hostPorts: (args: { threadId: string }) => PodHostPorts
  private readonly provisionLock: ProvisionLock

  constructor(
    private readonly args: PodDriverConfig & {
      engine?: PodDriverEngine | undefined
      launchServe?: PodServeLauncher | undefined
      hostPorts?: ((args: { threadId: string }) => PodHostPorts) | undefined
      provisionLock?: ProvisionLock | undefined
    },
  ) {
    this.engine =
      args.engine ??
      dockerEngineAt(args.socketPath ?? process.env.ATLAS_DOCKER_SOCKET ?? DEFAULT_SOCKET_PATH)
    this.injectedLaunch = args.launchServe
    this.hostPorts = args.hostPorts ?? defaultHostPorts
    this.provisionLock = args.provisionLock ?? fileProvisionLock()
  }

  async createOrResume(args: PodProvisionArgs<RunnerPodHandle>): Promise<PodPlacement> {
    assertPodNameBelongs({ name: args.name, threadId: args.threadId })
    return await this.nameKeyed({
      key: args.name,
      run: () =>
        this.provisionLock({
          name: args.name,
          run: async () => {
            const plan = await this.resolveServePlan()
            return provisionPod({ deps: this.depsFor(plan), provision: args })
          },
        }),
    })
  }

  async inspect(args: { name: string }): Promise<PodObservation | undefined> {
    const pod = await this.engine.inspectPod({ id: args.name })
    if (pod === undefined) return undefined
    const state = stateOf(pod.status)
    if (state !== 'running') return { state }
    const serve = pod.ports.find((port) => port.containerPort === SANDBOX_SERVE_PORT)
    return serve === undefined ? { state } : { state, url: `http://127.0.0.1:${serve.hostPort}` }
  }

  async writeBootstrapFile(args: {
    name: string
    path: string
    content: Uint8Array | string
  }): Promise<void> {
    const mkdir = boundedScript({
      script: `mkdir -p ${shellQuoted(posix.dirname(args.path))}`,
      seconds: BOOTSTRAP_MKDIR_SECONDS,
    })
    const made = await this.engine.execSh({
      id: args.name,
      script: mkdir.script,
      timeoutMs: mkdir.timeoutMs,
    })
    if (made.exitCode !== 0) {
      throw new Error(
        `could not create ${posix.dirname(args.path)} in pod ${args.name}: ${await made.stderr()}`,
      )
    }
    await this.engine.writeFile({
      id: args.name,
      path: args.path,
      content: args.content,
      mode: 0o600,
    })
  }

  async readResources(args: { name: string }): Promise<{ vcpus?: number; memoryMb?: number }> {
    const pod = await this.engine.inspectPod({ id: args.name })
    if (pod === undefined) return {}
    return {
      ...(pod.nanoCpus === 0 ? {} : { vcpus: pod.nanoCpus / NANO_CPUS_PER_VCPU }),
      ...(pod.memoryReservationBytes === 0 ? {} : { memoryMb: pod.memoryReservationBytes / MIB }),
    }
  }

  async updateResources(args: { name: string; vcpus: number }): Promise<void> {
    await this.engine.updateContainer({
      id: args.name,
      resources: {
        nanoCpus: args.vcpus * NANO_CPUS_PER_VCPU,
        memoryReservationBytes: memoryReservationBytesFor({
          vcpus: args.vcpus,
        }),
      },
    })
  }

  async destroy(args: { name: string; sessionId?: string | undefined }): Promise<void> {
    await this.engine.removePod({ id: args.name })
    const failures: unknown[] = []
    for (const volume of [
      workspaceVolumeNameOf({ podName: args.name }),
      dindVolumeNameOf({ podName: args.name }),
    ]) {
      await this.engine
        .removeVolume({ name: volume })
        .catch((failure: unknown) => failures.push(failure))
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, `destroy of pod ${args.name} left resources behind`)
    }
  }

  private depsFor(plan: ServePlan): PodProvisionDeps {
    return {
      engine: this.engine,
      image: this.args.image ?? DEFAULT_POD_IMAGE,
      home: this.args.home,
      vcpus: this.args.vcpus ?? DEFAULT_VCPUS,
      cloudUrl: this.args.cloudUrl,
      hostPorts: this.hostPorts,
      launchServe: plan.launchServe,
      desiredVersion: plan.version,
      log: this.args.log,
    }
  }

  private async resolveServePlan(): Promise<ServePlan> {
    const { devServe, log } = this.args
    if (devServe === undefined) {
      const install = releaseServeInstaller({ arch: podServeArchOf() })
      return {
        launchServe: this.injectedLaunch ?? this.launcherWith(install),
        version: this.args.serveVersion,
      }
    }
    const binary = await devServe({ log })
    log?.(
      `dev serve ${binary.version} resolved — installing it into pods instead of downloading a release`,
    )
    return {
      launchServe: this.injectedLaunch ?? this.launcherWith(devServeInstaller(binary)),
      version: binary.version,
    }
  }

  private launcherWith(install: PodServeInstaller): PodServeLauncher {
    return createPodServeLauncher({ install, log: this.args.log })
  }

  private nameKeyed<T>(args: { key: string; run: () => Promise<T> }): Promise<T> {
    const { key, run } = args
    const existing = this.inflightByName.get(key)
    if (existing !== undefined) return existing as Promise<T>
    const attempt = run().finally(() => {
      this.inflightByName.delete(key)
    })
    this.inflightByName.set(key, attempt)
    return attempt
  }
}
