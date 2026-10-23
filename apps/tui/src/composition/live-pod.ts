import { ERunner, type ThreadId } from '@dltech/atlas-core'
import {
  atlasDirectory,
  DEFAULT_DOCKER_SOCKET,
  DockerEngine,
  DockerPodDriver,
  createLocalPodBridge,
  pingDocker,
  putPodLease,
  reapOrphanPods,
  requireVercelCredentials,
  sandboxServeTokenFor,
  sandboxVcpusOf,
  type LocalPodBridgeOptions,
  type OrphanPodSweep,
} from '@dltech/atlas-harness'

import { buildInfo, clientVersionHeader } from '../build/info'
import { ENoticeTone } from '../ui/notice-store'
import type { BirthPreflight, CloudBridgeFactory } from './cloud/bridge-factory'
import { createCloudBridge } from './cloud/create-bridge'
import { devServeResolverFor } from './cloud/dev-serve'
import { ELinuxServeTarget } from './cloud/dev-serve-key'
import type { AtlasApp } from './compose'
import { durableOpLog } from './durable-op-log'
import { messageOf } from './error-text'
import {
  cloudEnvironmentOf,
  cloudUrlOf,
  liveBridgeOptionsFor,
  releaseBuildOf,
  telemetryEnvironmentOf,
} from './live-cloud'
import { noticePortBinding } from './notice-binding'

export const SIGN_IN_REQUIRED_MESSAGE = 'sign in to Atlas Cloud to start a session'

const dockerSocketPath = (): string => process.env.ATLAS_DOCKER_SOCKET ?? DEFAULT_DOCKER_SOCKET

export const livePodBridgeOptionsFor = (app: AtlasApp): LocalPodBridgeOptions => ({
  pod: () => {
    const release = releaseBuildOf()
    return {
      cloudUrl: cloudUrlOf(app),
      home: atlasDirectory(),
      vcpus: sandboxVcpusOf({ settings: app.settings }),
      ...(release === undefined
        ? {
            devServe: devServeResolverFor(buildInfo(), {
              target: process.arch === 'arm64' ? ELinuxServeTarget.Arm64 : ELinuxServeTarget.X64,
            }),
          }
        : { serveVersion: release.version }),
    }
  },
  onDriverLog: (line) => {
    durableOpLog()?.info({ source: 'pod.driver', message: line })
  },
  attachmentToken: ({ threadId }) => sandboxServeTokenFor({ secrets: app.secrets, threadId }),
  lastEventSeq: ({ threadId }) => app.log.head({ threadId }),
  settings: app.settings,
  projectIdOf: async ({ threadId }) => (await app.threads.find({ threadId }))?.projectId ?? null,
  registerPodLease: ({ threadId, token }: { threadId: ThreadId; token: string }) => {
    const session = app.cloud.session()
    if (session === null) throw new Error(SIGN_IN_REQUIRED_MESSAGE)
    return putPodLease({
      url: cloudUrlOf(app),
      sessionToken: session.token,
      clientVersion: clientVersionHeader(),
      threadId,
      token,
    })
  },
  environment: () => ({
    ...cloudEnvironmentOf(app.settings.snapshot().resolution),
    ...telemetryEnvironmentOf(),
  }),
})

export const liveBridgeFor =
  (app: AtlasApp): CloudBridgeFactory =>
  ({ runner }) =>
    runner === ERunner.Local
      ? createLocalPodBridge(livePodBridgeOptionsFor(app))
      : createCloudBridge(liveBridgeOptionsFor(app))

export const dockerRefusal = async (): Promise<string | null> => {
  const socketPath = dockerSocketPath()
  const reason = await pingDocker({ socketPath })
  if (reason === undefined) return null
  return `Docker isn't answering at ${socketPath} (${reason}) — start Docker Desktop, or point ATLAS_DOCKER_SOCKET at a running engine`
}

export const liveBirthPreflightFor =
  (app: AtlasApp): BirthPreflight =>
  async ({ runner }) => {
    if (runner === ERunner.Local) return dockerRefusal()
    try {
      requireVercelCredentials({ settings: app.settings, secrets: app.secrets })
      return null
    } catch (error) {
      return messageOf(error)
    }
  }

export const podReapFailureNotice = (sweep: OrphanPodSweep): string | null => {
  const first = sweep.failures[0]
  if (first === undefined) return null
  return `${sweep.failures.length} orphaned pod${sweep.failures.length === 1 ? '' : 's'} could not be removed — ${messageOf(first.error)}`
}

export const reapOrphanPodsWith = (deps: {
  reap: () => Promise<OrphanPodSweep>
  notify: (text: string) => void
}): Promise<void> =>
  deps
    .reap()
    .then((sweep) => {
      const text = podReapFailureNotice(sweep)
      if (text !== null) deps.notify(text)
    })
    .catch(() => undefined)

export const reapOrphanPodsOnBoot = (app: AtlasApp): void => {
  const socketPath = dockerSocketPath()
  const driver = new DockerPodDriver({
    cloudUrl: cloudUrlOf(app),
    home: atlasDirectory(),
    socketPath,
  })
  void reapOrphanPodsWith({
    reap: () =>
      reapOrphanPods({
        engine: new DockerEngine({ socketPath }),
        destroyPod: (pod) => driver.destroy(pod),
        threadExists: async ({ threadId }) => (await app.threads.find({ threadId })) !== undefined,
        home: atlasDirectory(),
        log: (line) => {
          durableOpLog()?.info({ source: 'pod.reaper', message: line })
        },
      }),
    notify: (text) => noticePortBinding().notify({ text, tone: ENoticeTone.Warn }),
  })
}
