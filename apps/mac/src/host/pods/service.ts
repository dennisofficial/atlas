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
  list: () => Promise<LocalPod[]>
  get: (args: { threadId: string }) => Promise<LocalPod | undefined>
  create: (args: { input: CreatePodInput }) => Promise<LocalPod>
  wake: (args: { threadId: string }) => Promise<LocalPod | undefined>
  connect: (args: { threadId: string }) => Promise<IPodConnect | undefined | 'not-running'>
  destroy: (args: { threadId: string }) => Promise<void>
}

export function createPodService({
  config,
  bearer,
}: {
  config: IPodHostConfig
  bearer: () => string | undefined
}): IPodService {
  const secrets = new FileSecretsStore({
    file: join(config.home, 'secrets.json'),
    cipher: new SecretCipher(join(config.home, 'key')),
  })
  const index = createPodIndex({ home: config.home })
  const socketPath = config.socketPath ?? DEFAULT_DOCKER_SOCKET
  const now = config.now ?? Date.now
  const apiOrigin = config.apiOrigin ?? resolveApiOrigin(process.env)

  const bridgeFor = (): CloudBridge =>
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
        bearer,
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

  const provision = async ({ entry }: { entry: PodIndexEntry }): Promise<LocalPod> => {
    const bridge = bridgeFor()
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
    list: async () => {
      const bridge = bridgeFor()
      return Promise.all(
        index
          .list()
          .map(async (entry) =>
            podOf({ entry, state: (await stateOf({ bridge, threadId: entry.threadId })).state }),
          ),
      )
    },
    get: async ({ threadId }) => {
      const entry = index.find({ threadId })
      if (entry === undefined) return undefined
      const { state } = await stateOf({ bridge: bridgeFor(), threadId })
      return podOf({ entry, state })
    },
    create: async ({ input }) => {
      const held = index.find({ threadId: input.threadId })
      const entry: PodIndexEntry = held ?? {
        ...input,
        createdAt: new Date(now()).toISOString(),
      }
      return provision({ entry })
    },
    wake: async ({ threadId }) => {
      const entry = index.find({ threadId })
      return entry === undefined ? undefined : provision({ entry })
    },
    connect: async ({ threadId }) => {
      if (index.find({ threadId }) === undefined) return undefined
      const { state, url } = await stateOf({ bridge: bridgeFor(), threadId })
      if (state !== ELocalPodState.Running || url === undefined) return 'not-running'
      return {
        url,
        token: sandboxServeTokenFor({ secrets, threadId: toThreadId(threadId) }),
        expiresAt: new Date(now() + CONNECT_TTL_MS).toISOString(),
      }
    },
    destroy: async ({ threadId }) => {
      await bridgeFor().sandboxes.destroy({ threadId: toThreadId(threadId) })
      index.remove({ threadId })
      secrets.remove(sandboxServeTokenName(toThreadId(threadId)))
    },
  }
}
