import { ERunner, type ThreadId } from '@dltech/atlas-core'
import {
  atlasDirectory,
  DEFAULT_DOCKER_SOCKET,
  DockerEngine,
  DockerPodDriver,
  createLocalPodBridge,
  createSignedInApiPodBridge,
  pingDocker,
  putPodLease,
  readLocalPodCheckpoint,
  registerLocalPodThread,
  reapOrphanPods,
  sandboxServeTokenFor,
  sandboxVcpusOf,
  type CloudBridge,
  type LocalPodBridgeOptions,
  type OrphanPodSweep,
} from '@dltech/atlas-harness'

import { buildInfo, clientVersionHeader } from '../build/info'
import { ENoticeTone } from '../ui/notice-store'
import type { BirthPreflight, BootStepListener, CloudBridgeFactory } from './cloud/bridge-factory'
import { createCloudBridge } from './cloud/create-bridge'
import { devServeResolverFor } from './cloud/dev-serve'
import { ELinuxServeTarget } from './cloud/dev-serve-key'
import type { AtlasApp } from './compose'
import { durableOpLog } from './durable-op-log'
import { messageOf } from './error-text'
import {
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
  registerThread: ({ threadId, projectId, model, effort }) => {
    const session = app.cloud.session()
    if (session === null) throw new Error(SIGN_IN_REQUIRED_MESSAGE)
    return registerLocalPodThread({
      url: cloudUrlOf(app),
      sessionToken: session.token,
      clientVersion: clientVersionHeader(),
      threadId,
      projectId,
      ...(model === undefined ? {} : { model }),
      ...(effort === undefined ? {} : { effort }),
    })
  },
  readPodCheckpoint: ({ threadId }) => {
    const session = app.cloud.session()
    if (session === null) return Promise.resolve(null)
    return readLocalPodCheckpoint({
      url: cloudUrlOf(app),
      sessionToken: session.token,
      clientVersion: clientVersionHeader(),
      threadId,
    })
  },
  environment: telemetryEnvironmentOf,
})

export type BridgeBuilders = {
  pod: typeof createLocalPodBridge
  api: typeof createSignedInApiPodBridge
  direct: typeof createCloudBridge
}

const DEFAULT_BUILDERS: BridgeBuilders = {
  pod: createLocalPodBridge,
  api: createSignedInApiPodBridge,
  direct: createCloudBridge,
}

export const liveApiPodBridgeFor = (args: {
  app: AtlasApp
  onBootStep?: BootStepListener | undefined
  build?: BridgeBuilders['api'] | undefined
}): CloudBridge =>
  (args.build ?? createSignedInApiPodBridge)({
    session: () => args.app.cloud.session(),
    clientVersion: clientVersionHeader(),
    settings: args.app.settings,
    lastEventSeq: ({ threadId }) => args.app.log.head({ threadId }),
    onBootStep: args.onBootStep,
  })

export const liveBridgeFor =
  (app: AtlasApp, builders: BridgeBuilders = DEFAULT_BUILDERS): CloudBridgeFactory =>
  ({ runner, onBootStep }) => {
    if (runner === ERunner.Local) return builders.pod(livePodBridgeOptionsFor(app))
    if (app.pods) return liveApiPodBridgeFor({ app, onBootStep, build: builders.api })
    return builders.direct(liveBridgeOptionsFor(app))
  }

export const dockerRefusal = async (): Promise<string | null> => {
  const socketPath = dockerSocketPath()
  const reason = await pingDocker({ socketPath })
  if (reason === undefined) return null
  return `Docker isn't answering at ${socketPath} (${reason}) — start Docker Desktop, or point ATLAS_DOCKER_SOCKET at a running engine`
}

export const liveBirthPreflight: BirthPreflight = async ({ runner }) =>
  runner === ERunner.Local ? dockerRefusal() : null

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
