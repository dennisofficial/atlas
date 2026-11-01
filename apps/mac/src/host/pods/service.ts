import { join } from 'node:path'
import {
  createCurrentActivityValidator,
  createFileActivityOutcomes,
  createLocalActivityInspector,
  createLocalActivityObserver,
  createPassiveActivityConnection,
  type OpenLocalActivityConnection,
} from '@dltech/atlas-harness/activity'
import {
  atlasDirectory,
  registryFor,
  DEFAULT_DOCKER_SOCKET,
  ECloudSandboxState,
  createLocalPodBridge,
  pingDocker,
  sandboxServeTokenFor,
  sandboxServeTokenName,
  type CloudBridge,
} from '@dltech/atlas-harness'
import { ERunner, toThreadId } from '@dltech/atlas-core'
import { resolveApiOrigin } from '../api-origin'
import type { IPodHostConfig } from './config'
import { leaseRegistrarFor } from './lease'
import { openLocalStore } from './local-store'
import {
  ensurePodRecord,
  findPodRecord,
  listPodRecords,
  removePodRecord,
  type PodRecord,
} from './pod-records'
import { createPodThreads, type IPodThreads } from './pod-threads'
import { createThreadReads, type IThreadReads } from './thread-reads'
import { createPodResources, type IPodResources } from './resources'
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

export interface IPodService extends IThreadReads, IPodResources {
  capabilities: () => Promise<DesktopCapabilities>
  list: () => Promise<LocalPod[]>
  get: (args: { threadId: string }) => Promise<LocalPod | undefined>
  create: (args: { input: CreatePodInput }) => Promise<LocalPod>
  wake: (args: { threadId: string }) => Promise<LocalPod | undefined>
  connect: (args: { threadId: string }) => Promise<IPodConnect | undefined | 'not-running'>
  destroy: (args: { threadId: string }) => Promise<boolean>
  close: () => Promise<void>
}

const localPodOf = ({ record, state }: { record: PodRecord; state: ELocalPodState }): LocalPod => ({
  threadId: record.id,
  projectId: record.projectId,
  ...(record.model === undefined ? {} : { model: record.model.ref, effort: record.model.effort }),
  ...(record.title === undefined ? {} : { title: record.title }),
  archivedAt: record.archivedAt,
  createdAt: record.createdAt,
  state,
})

export function createPodService({
  config,
  bearer,
}: {
  config: IPodHostConfig
  bearer: () => string | undefined
}): IPodService {
  const store = openLocalStore({ home: atlasDirectory() })
  const socketPath = config.socketPath ?? DEFAULT_DOCKER_SOCKET
  const now = config.now ?? Date.now
  const apiOrigin = config.apiOrigin ?? resolveApiOrigin(process.env)

  const bridge = (): CloudBridge =>
    createLocalPodBridge({
      pod: () => ({
        cloudUrl: apiOrigin,
        home: store.home,
        socketPath,
        ...(config.devServe === undefined
          ? { serveVersion: config.serveVersion }
          : { devServe: config.devServe }),
      }),
      attachmentToken: ({ threadId }) => sandboxServeTokenFor({ secrets: store.secrets, threadId }),
      lastEventSeq: ({ threadId }) => store.log.head({ threadId }),
      projectIdOf: async ({ threadId }) =>
        (await findPodRecord({ store, threadId }))?.projectId ?? null,
      registerPodLease: leaseRegistrarFor({
        apiOrigin,
        bearer,
        ...(config.clientVersion === undefined ? {} : { clientVersion: config.clientVersion }),
      }),
      ...(config.driverWith === undefined ? {} : { driverWith: config.driverWith }),
    })
  const pods: IPodThreads = createPodThreads({ store, bridge })
  const inspector = createLocalActivityInspector({ find: (args) => bridge().sandboxes.find(args) })
  const existingToken = ({ threadId }: { threadId: ReturnType<typeof toThreadId> }) =>
    store.secrets.read(sandboxServeTokenName(threadId))
  const freshConnection: OpenLocalActivityConnection = (args) =>
    createPassiveActivityConnection({ ...args, token: existingToken })
  const validateCurrent = createCurrentActivityValidator({ inspector, open: freshConnection })
  const activity = createLocalActivityObserver({
    known: async ({ threadId }) => {
      const record = await store.threads.find({ threadId })
      return record?.runner === ERunner.Local && record.agent === undefined
    },
    inspector,
    open: (args) =>
      createPassiveActivityConnection({
        ...args,
        token: existingToken,
        home: { path: store.home, threads: store.threads },
      }),
    outcomes: createFileActivityOutcomes({
      pathFor: async ({ threadId }) =>
        join(
          await registryFor({ home: store.home }).sessionDirFor({ threadId }),
          'threads',
          `${threadId}.activity.json`,
        ),
      validateCurrent,
    }),
  })

  const stateOf = async (threadId: string): Promise<{ state: ELocalPodState; url?: string }> => {
    const found = await bridge().sandboxes.find({ threadId: toThreadId(threadId) })
    const running = found?.state === ECloudSandboxState.Running
    return {
      state: running ? ELocalPodState.Running : ELocalPodState.Stopped,
      ...(found?.url === undefined ? {} : { url: found.url }),
    }
  }

  const reported = async (record: PodRecord): Promise<LocalPod> =>
    localPodOf({ record, state: (await stateOf(record.id)).state })

  const woken = async (record: PodRecord): Promise<LocalPod> => {
    await pods.wake({ threadId: record.id })
    return reported((await findPodRecord({ store, threadId: record.id })) ?? record)
  }

  const recordOf = (threadId: string) => findPodRecord({ store, threadId: toThreadId(threadId) })
  let shutdown: Promise<void> | undefined

  return {
    ...createThreadReads({ store, pods, activity }),
    ...createPodResources({ home: store.home, bridge }),
    capabilities: async () => {
      const reason = await (config.ping ?? (() => pingDocker({ socketPath })))()
      return reason === undefined ? { docker: true } : { docker: false, reason }
    },
    list: async () => Promise.all((await listPodRecords({ store })).map(reported)),
    get: async ({ threadId }) => {
      const record = await recordOf(threadId)
      return record === undefined ? undefined : reported(record)
    },
    create: async ({ input }) => {
      const threadId = toThreadId(input.threadId)
      const existing = await findPodRecord({ store, threadId })
      if (existing !== undefined) return woken(existing)
      const record = await ensurePodRecord({ store, input })
      try {
        const sandbox = await bridge().sandboxes.create({
          threadId,
          projectId: input.projectId,
          ...(input.model === undefined ? {} : { model: input.model }),
          ...(input.effort === undefined ? {} : { birth: { effort: input.effort } }),
        })
        await pods.dial({ threadId, url: sandbox.url, token: sandbox.token })
        return reported(record)
      } catch (error) {
        await pods.release({ threadId })
        await removePodRecord({ store, threadId })
        throw error
      }
    },
    wake: async ({ threadId }) => {
      const record = await recordOf(threadId)
      return record === undefined ? undefined : woken(record)
    },
    connect: async ({ threadId }) => {
      const record = await recordOf(threadId)
      if (record === undefined) return undefined
      const { state, url } = await stateOf(threadId)
      if (state !== ELocalPodState.Running || url === undefined) return 'not-running'
      void pods
        .dial({
          threadId: record.id,
          url,
          token: sandboxServeTokenFor({ secrets: store.secrets, threadId: record.id }),
        })
        .catch(() => undefined)
      return {
        url,
        token: sandboxServeTokenFor({ secrets: store.secrets, threadId: record.id }),
        expiresAt: new Date(now() + CONNECT_TTL_MS).toISOString(),
      }
    },
    destroy: async ({ threadId }) => {
      const record = await recordOf(threadId)
      if (record === undefined) return false
      const id = record.id
      await pods.release({ threadId: id })
      await bridge().sandboxes.destroy({ threadId: id })
      store.secrets.remove(sandboxServeTokenName(id))
      await removePodRecord({ store, threadId: id })
      return true
    },
    close: () => {
      shutdown ??= Promise.all([activity.close(), validateCurrent.close(), pods.closeAll()]).then(
        () => undefined,
      )
      return shutdown
    },
  }
}
