import { createHash } from 'node:crypto'

import {
  EServeEnv,
  POD_INGRESS_HOST_PORT_ENV,
  SANDBOX_HOME_PATH,
  SANDBOX_SERVE_PORT,
  SANDBOX_WORKSPACES_PATH,
} from '@dltech/atlas-wire'

import type { CreateContainerBody } from '../../execution/docker/engine'
import { POD_INGRESS_CONTAINER_PORT } from './ingress'

export const DEFAULT_POD_IMAGE = 'ghcr.io/dennisofficial/atlas-sandbox:latest'

export const POD_LABEL_PREFIX = 'atlas-pod'

export const podThreadLabel = `${POD_LABEL_PREFIX}.thread`

export const podRoleLabel = `${POD_LABEL_PREFIX}.role`

export const podHomeLabel = `${POD_LABEL_PREFIX}.home`

export const POD_ROLE = 'pod'

export const MEMORY_MB_PER_VCPU = 2048

export const MIB = 1024 * 1024

export const memoryReservationBytesFor = (args: { vcpus: number }): number =>
  args.vcpus * MEMORY_MB_PER_VCPU * MIB

export const POD_NAME_ENV = 'ATLAS_POD_NAME'

export const SANDBOX_SESSION_ID_ENV = 'ATLAS_SANDBOX_SESSION_ID'

const DIGEST_LENGTH = 24
const HOME_DIGEST_LENGTH = 16
const DIND_STORAGE_PATH = '/var/lib/docker'
const VENDOR_ENV_PREFIX = 'VERCEL_'

export const podNameFor = (args: { threadId: string }): string =>
  `${POD_LABEL_PREFIX}-${createHash('sha256').update(args.threadId).digest('hex').slice(0, DIGEST_LENGTH)}`

export const podHomeDigestOf = (args: { home: string }): string =>
  createHash('sha256').update(args.home).digest('hex').slice(0, HOME_DIGEST_LENGTH)

export const podLabelsFor = (args: { threadId: string; home: string }): Record<string, string> => ({
  [podThreadLabel]: args.threadId,
  [podRoleLabel]: POD_ROLE,
  [podHomeLabel]: podHomeDigestOf({ home: args.home }),
})

export const workspaceVolumeNameOf = (args: { podName: string }): string =>
  `${args.podName}-workspace`

export const dindVolumeNameOf = (args: { podName: string }): string => `${args.podName}-docker`

export const workspaceVolumeNameFor = (args: { threadId: string }): string =>
  workspaceVolumeNameOf({ podName: podNameFor(args) })

export const dindVolumeNameFor = (args: { threadId: string }): string =>
  dindVolumeNameOf({ podName: podNameFor(args) })

export type PodCreateArgs = {
  threadId: string
  home: string
  image: string
  serveHostPort: number
  ingressHostPort: number
  vcpus: number
  token: string
  cloudUrl: string
  pinnedModel?: string | undefined
  environment: Record<string, string>
}

const callerEnvironment = (environment: Record<string, string>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(environment).filter(([key]) => !key.startsWith(VENDOR_ENV_PREFIX)),
  )

const podEnv = (args: PodCreateArgs): string[] =>
  Object.entries({
    [EServeEnv.Token]: args.token,
    [EServeEnv.Port]: String(SANDBOX_SERVE_PORT),
    [EServeEnv.ThreadId]: args.threadId,
    [EServeEnv.CloudUrl]: args.cloudUrl,
    ATLAS_HOME: SANDBOX_HOME_PATH,
    [POD_NAME_ENV]: podNameFor(args),
    [SANDBOX_SESSION_ID_ENV]: podNameFor(args),
    [POD_INGRESS_HOST_PORT_ENV]: String(args.ingressHostPort),
    ...(args.pinnedModel === undefined ? {} : { [EServeEnv.Model]: args.pinnedModel }),
    ...callerEnvironment(args.environment),
  }).map(([key, value]) => `${key}=${value}`)

const loopbackBinding = (hostPort: number) => [{ HostIp: '127.0.0.1', HostPort: String(hostPort) }]

export function podCreateBody(args: PodCreateArgs): CreateContainerBody {
  const servePort = `${SANDBOX_SERVE_PORT}/tcp`
  const ingressPort = `${POD_INGRESS_CONTAINER_PORT}/tcp`

  return {
    Image: args.image,
    Cmd: ['sleep', 'infinity'],
    Labels: podLabelsFor({ threadId: args.threadId, home: args.home }),
    Env: podEnv(args),
    ExposedPorts: { [servePort]: {}, [ingressPort]: {} },
    HostConfig: {
      Init: true,
      Privileged: true,
      Mounts: [
        { Type: 'volume', Source: workspaceVolumeNameFor(args), Target: SANDBOX_WORKSPACES_PATH },
        { Type: 'volume', Source: dindVolumeNameFor(args), Target: DIND_STORAGE_PATH },
      ],
      NanoCpus: args.vcpus * 1e9,
      MemoryReservation: memoryReservationBytesFor({ vcpus: args.vcpus }),
      PortBindings: {
        [servePort]: loopbackBinding(args.serveHostPort),
        [ingressPort]: loopbackBinding(args.ingressHostPort),
      },
    },
  }
}
