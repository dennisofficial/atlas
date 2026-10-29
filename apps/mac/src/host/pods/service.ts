import { join } from 'node:path'
import {
  DEFAULT_DOCKER_SOCKET,
  ECloudSandboxState,
  FileSecretsStore,
  SecretCipher,
  createLocalPodBridge,
  pingDocker,
  sandboxServeTokenFor,
  sandboxServeTokenName,
  type CloudBridge,
} from '@dltech/atlas-harness'
import { toThreadId } from '@dltech/atlas-core'
import { resolveApiOrigin } from '../api-origin'
import type { IPodHostConfig } from './config'
import { leaseRegistrarFor } from './lease'
import { createPodIndex, type PodIndexEntry } from './pod-index'
import {
  ELocalPodState,
  type CreatePodInput,
  type DesktopCapabilities,
  type LocalPod,
} from './wire'

export const CONNECT_TTL_MS = 60_000

export interface IPodConnect {
  url: string
  token: string
  expiresAt: string
}

export interface IPodService {
  capabilities: () => Promise<DesktopCapabilities>
  list: (args: { cookie: string | null }) => Promise<LocalPod[]>
  get: (args: { threadId: string; cookie: string | null }) => Promise<LocalPod | undefined>
  create: (args: { input: CreatePodInput; cookie: string | null }) => Promise<LocalPod>
  wake: (args: { threadId: string; cookie: string | null }) => Promise<LocalPod | undefined>
  connect: (args: {
    threadId: string
    cookie: string | null
  }) => Promise<IPodConnect | undefined | 'not-running'>
  destroy: (args: { threadId: string; cookie: string | null }) => Promise<void>
}

export function createPodService({ config }: { config: IPodHostConfig }): IPodService {
  const secrets = new FileSecretsStore({
    file: join(config.home, 'secrets.json'),
    cipher: new SecretCipher(join(config.home, 'key')),
  })
  const index = createPodIndex({ home: config.home })
  const socketPath = config.socketPath ?? DEFAULT_DOCKER_SOCKET
  const now = config.now ?? Date.now
  const apiOrigin = config.apiOrigin ?? resolveApiOrigin(process.env)

  const bridgeFor = ({ cookie }: { cookie: string | null }): CloudBridge =>
    createLocalPodBridge({
      pod: () => ({
        cloudUrl: apiOrigin,
        home: config.home,
        socketPath,
        ...(config.devServe === undefined
          ? { serveVersion: config.serveVersion }
          : { devServe: config.devServe }),
      }),
      attachmentToken: ({ threadId }) => sandboxServeTokenFor({ secrets, threadId }),
      registerPodLease: leaseRegistrarFor({
        apiOrigin,
        cookie,
        ...(config.clientVersion === undefined ? {} : { clientVersion: config.clientVersion }),
      }),
      ...(config.driverWith === undefined ? {} : { driverWith: config.driverWith }),
    })

  const stateOf = async ({
    bridge,
    threadId,
  }: {
    bridge: CloudBridge
    threadId: string
  }): Promise<{ state: ELocalPodState; url?: string | undefined }> => {
    const found = await bridge.sandboxes.find({ threadId: toThreadId(threadId) })
    const running = found?.state === ECloudSandboxState.Running
    return { state: running ? ELocalPodState.Running : ELocalPodState.Stopped, url: found?.url }
  }

  const podOf = ({ entry, state }: { entry: PodIndexEntry; state: ELocalPodState }): LocalPod => ({
    ...entry,
    state,
  })

  const provision = async ({
    entry,
    cookie,
  }: {
    entry: PodIndexEntry
    cookie: string | null
  }): Promise<LocalPod> => {
    const bridge = bridgeFor({ cookie })
    await bridge.sandboxes.create({
      threadId: toThreadId(entry.threadId),
      projectId: entry.projectId,
      ...(entry.model === undefined ? {} : { model: entry.model }),
      ...(entry.effort === undefined ? {} : { birth: { effort: entry.effort } }),
    })
    index.put(entry)
    const { state } = await stateOf({ bridge, threadId: entry.threadId })
    return podOf({ entry, state })
  }

  return {
    capabilities: async () => {
      const reason = await (config.ping ?? (() => pingDocker({ socketPath })))()
      return reason === undefined ? { docker: true } : { docker: false, reason }
    },
    list: async ({ cookie }) => {
      const bridge = bridgeFor({ cookie })
      return Promise.all(
        index
          .list()
          .map(async (entry) =>
            podOf({ entry, state: (await stateOf({ bridge, threadId: entry.threadId })).state }),
          ),
      )
    },
    get: async ({ threadId, cookie }) => {
      const entry = index.find({ threadId })
      if (entry === undefined) return undefined
      const { state } = await stateOf({ bridge: bridgeFor({ cookie }), threadId })
      return podOf({ entry, state })
    },
    create: async ({ input, cookie }) => {
      const held = index.find({ threadId: input.threadId })
      const entry: PodIndexEntry = held ?? {
        ...input,
        createdAt: new Date(now()).toISOString(),
      }
      return provision({ entry, cookie })
    },
    wake: async ({ threadId, cookie }) => {
      const entry = index.find({ threadId })
      return entry === undefined ? undefined : provision({ entry, cookie })
    },
    connect: async ({ threadId, cookie }) => {
      if (index.find({ threadId }) === undefined) return undefined
      const { state, url } = await stateOf({ bridge: bridgeFor({ cookie }), threadId })
      if (state !== ELocalPodState.Running || url === undefined) return 'not-running'
      return {
        url,
        token: sandboxServeTokenFor({ secrets, threadId: toThreadId(threadId) }),
        expiresAt: new Date(now() + CONNECT_TTL_MS).toISOString(),
      }
    },
    destroy: async ({ threadId, cookie }) => {
      await bridgeFor({ cookie }).sandboxes.destroy({ threadId: toThreadId(threadId) })
      index.remove({ threadId })
      secrets.remove(sandboxServeTokenName(toThreadId(threadId)))
    },
  }
}
