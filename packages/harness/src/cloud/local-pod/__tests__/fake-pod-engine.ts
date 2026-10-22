import { expect } from 'bun:test'

import { SANDBOX_SERVE_PORT, type DevServeResolver } from '@dltech/atlas-wire'

import type { ContainerSummary, CreateContainerBody } from '../../../execution/docker/engine'
import { EngineRequestFailed } from '../../../execution/docker/engine'
import type { PodDetails } from '../../../execution/docker/pod-engine'
import { DockerPodDriver, type PodDriverEngine } from '../driver'
import { POD_INGRESS_CONTAINER_PORT } from '../ingress'
import { podNameFor, podThreadLabel } from '../pod-create'
import { POD_STAGED_PATH } from '../pod-staged'
import type { ProvisionLock } from '../provision-lock'
import type { PodServeLauncher } from '../serve-launch'

export const THREAD = 'thread-1'
export const NAME = podNameFor({ threadId: THREAD })
export const SERVE_HOST_PORT = 20_111
export const INGRESS_HOST_PORT = 20_222
export const GIB = 1024 * 1024 * 1024

type FakeOptions = {
  existing?: { id: string; status: string }
  conflictOnCreate?: boolean
  failVolumeRemoval?: boolean
  failVolumeRemovalOf?: string
  staged?: boolean
  loseCreateResponse?: boolean
  markerProbeExitCode?: number
  podDetails?: Partial<PodDetails>
}

export const detailsFor = (args: {
  id: string
  status: string
  extra?: Partial<PodDetails> | undefined
}): PodDetails => ({
  id: args.id,
  name: NAME,
  status: args.status,
  running: args.status === 'running',
  labels: {},
  ports: [
    { containerPort: SANDBOX_SERVE_PORT, hostPort: SERVE_HOST_PORT },
    { containerPort: POD_INGRESS_CONTAINER_PORT, hostPort: INGRESS_HOST_PORT },
  ],
  nanoCpus: 0,
  memoryReservationBytes: 0,
  ...args.extra,
})

export const fakeEngine = (options: FakeOptions = {}) => {
  const calls: string[] = []
  const created: Array<{ name: string; body: CreateContainerBody }> = []
  const volumes: Array<{ name: string; labels: Record<string, string> }> = []
  const updates: Array<{ id: string; nanoCpus: number; memoryReservationBytes: number }> = []
  const scripts: string[] = []
  const files: Array<{ id: string; path: string; mode: number | undefined }> = []
  let existing = options.existing
  let staged = options.staged ?? options.existing !== undefined

  const engine: PodDriverEngine = {
    async listContainers(args) {
      calls.push('list')
      expect(args.labels).toEqual({ [podThreadLabel]: THREAD })
      expect(args.all).toBe(true)
      if (existing === undefined) return []
      const summary: ContainerSummary = {
        id: existing.id,
        name: `/${NAME}`,
        state: existing.status,
        labels: {},
      }
      return [summary]
    },
    async createContainer(args) {
      calls.push('create')
      created.push(args)
      existing = { id: 'fresh-id', status: 'created' }
      if (options.loseCreateResponse === true) throw new Error('connection reset')
      if (options.conflictOnCreate === true) {
        existing = { id: 'rival-id', status: 'exited' }
        staged = true
        throw new EngineRequestFailed({ status: 409, message: 'name in use' })
      }
      return { id: 'fresh-id', warnings: [] }
    },
    async inspectPod(args) {
      calls.push('inspect')
      if (existing === undefined) return undefined
      if (args.id !== existing.id && args.id !== NAME) return undefined
      return detailsFor({ id: existing.id, status: existing.status, extra: options.podDetails })
    },
    async startPod(args) {
      calls.push(`start:${args.id}`)
      if (existing !== undefined) existing = { ...existing, status: 'running' }
    },
    async removePod(args) {
      calls.push(`removePod:${args.id}`)
      existing = undefined
      staged = false
    },
    async createVolume(args) {
      calls.push('volume')
      volumes.push(args)
    },
    async removeVolume(args) {
      calls.push(`removeVolume:${args.name}`)
      if (options.failVolumeRemoval === true || options.failVolumeRemovalOf === args.name) {
        throw new Error('volume busy')
      }
    },
    async updateContainer(args) {
      calls.push('update')
      updates.push({ id: args.id, ...args.resources })
    },
    async writeFile(args) {
      calls.push('writeFile')
      files.push({ id: args.id, path: args.path, mode: args.mode })
      if (args.path === POD_STAGED_PATH) staged = true
    },
    async execSh(args) {
      scripts.push(args.script)
      if (args.script === `test -e ${POD_STAGED_PATH}`) {
        const exitCode = options.markerProbeExitCode ?? (staged ? 0 : 1)
        return { exitCode, stdout: async () => '', stderr: async () => 'probe failed' }
      }
      return { exitCode: 0, stdout: async () => '', stderr: async () => '' }
    },
  }
  return { engine, calls, created, volumes, updates, scripts, files }
}

export const unlockedProvision: ProvisionLock = (args) => args.run()

export const driverWith = (args: {
  engine: PodDriverEngine
  launchServe?: PodServeLauncher
  desiredVersion?: string
  devServe?: DevServeResolver
  log?: (line: string) => void
  provisionLock?: ProvisionLock
}) =>
  new DockerPodDriver({
    engine: args.engine,
    cloudUrl: 'http://cloud.test',
    home: '/home/test/.atlas',
    serveVersion: args.desiredVersion,
    devServe: args.devServe,
    provisionLock: args.provisionLock ?? unlockedProvision,
    log: args.log,
    hostPorts: () => ({ serveHostPort: SERVE_HOST_PORT, ingressHostPort: INGRESS_HOST_PORT }),
    launchServe: args.launchServe ?? (async () => ({})),
  })
