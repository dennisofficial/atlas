import {
  ATLAS_TELEMETRY_IDENTITY_ENV,
  EExecutionLocation,
  ELocationChangeCause,
  ESettingId,
  ESettingsLayer,
  textValueOf,
  type SettingsResolution,
  type ThreadId,
} from '@dltech/atlas-core'
import {
  atlasDirectory,
  persistedTelemetryDistinctId,
  requireVercelCredentials,
  SandboxClient,
  sandboxImageOf,
  sandboxServeTokenFor,
  sandboxVcpusOf,
  storedModel,
  type LocalCloudBridgeOptions,
} from '@dltech/atlas-harness'

import { buildInfo, clientVersionHeader, EBuildKind } from '../build/info'
import { ENoticeTone } from '../ui/notice-store'
import { devServeResolverFor } from './cloud/dev-serve'
import { durableOpLog } from './durable-op-log'
import { reapExpiredCloudSandboxes } from './cloud/reaper'
import { liveReaperListFailureMark } from './cloud/reaper-failure-marker'
import type { AtlasApp } from './compose'
import { messageOf } from './error-text'
import { noticePortBinding } from './notice-binding'

type RegistryMetadata = { title?: string; repo?: string; model?: string }

export const releaseBuildOf = (): { version: string } | undefined => {
  const build = buildInfo()
  if (build.kind !== EBuildKind.Release) return undefined
  return { version: build.version }
}

export const cloudEnvironmentOf = (resolution: SettingsResolution): Record<string, string> => {
  const entries: Record<string, string> = {}
  const carry = (id: ESettingId, variable: string): void => {
    const held = resolution.settings.get(id)
    if (held === undefined || held.layer === ESettingsLayer.Default) return
    const value = textValueOf({ resolution, id })
    if (value.length > 0) entries[variable] = value
  }
  carry(ESettingId.DecisionsProvider, 'ATLAS_DECISIONS_PROVIDER')
  carry(ESettingId.DecisionsUrl, 'ATLAS_DECISIONS_URL')
  carry(ESettingId.DecisionsModel, 'ATLAS_DECISIONS_MODEL')
  carry(ESettingId.ClassifierMode, 'ATLAS_CLASSIFIER_MODE')
  carry(ESettingId.WebSearchBackend, 'ATLAS_SEARCH_BACKEND')
  return entries
}

export const telemetryEnvironmentOf = (): Record<string, string> => {
  const id = persistedTelemetryDistinctId({ atlasHome: atlasDirectory() })
  return id === undefined ? {} : { [ATLAS_TELEMETRY_IDENTITY_ENV]: id }
}

const registryMetadataOf = async (args: {
  app: AtlasApp
  threadId: ThreadId
}): Promise<RegistryMetadata | undefined> => {
  const metadata: RegistryMetadata = {}
  const held = await args.app.threads.find({ threadId: args.threadId })
  if (held?.title !== undefined) metadata.title = held.title
  if (held?.repo !== undefined && held?.repo !== null) metadata.repo = held.repo
  metadata.model = storedModel(args.app.model.choice()).ref
  return metadata
}

export const cloudUrlOf = (app: {
  cloud: { session(): { url: string } | null }
  settings: { snapshot(): { resolution: SettingsResolution } }
}): string =>
  app.cloud.session()?.url ??
  textValueOf({ resolution: app.settings.snapshot().resolution, id: ESettingId.CloudUrl })

export const liveBridgeOptionsFor = (app: AtlasApp): LocalCloudBridgeOptions => ({
  vercel: () => ({
    credentials: requireVercelCredentials({ settings: app.settings, secrets: app.secrets }),
    ...sandboxImageOf({
      settings: app.settings,
      release: releaseBuildOf(),
      devServe: devServeResolverFor(buildInfo()),
    }),
    vcpus: sandboxVcpusOf({ settings: app.settings }),
  }),
  // The driver's settle and provision narration is the only record of a wake that failed
  // before the channel could speak — persist it, or the next name-conflict incident leaves
  // nothing to classify from.
  onDriverLog: (line) => {
    durableOpLog()?.info({ source: 'cloud.driver', message: line })
  },
  attachmentToken: ({ threadId }) => sandboxServeTokenFor({ secrets: app.secrets, threadId }),
  // The local durable log is the truth the serve's currency vouch is checked against: report
  // its head on the Hello so a clean re-attach of an unchanged transcript is vouched current.
  lastEventSeq: ({ threadId }) => app.log.head({ threadId }),
  localLog: app.log,
  settings: app.settings,
  projectIdOf: async ({ threadId }) => (await app.threads.find({ threadId }))?.projectId ?? null,
  authorizeSandbox: (authorization) => app.cloud.prepareSandboxOauth(authorization),
  cloudUrl: () => cloudUrlOf(app),
  registration: async ({ threadId }) => {
    if (app.cloud.session() === null) return undefined
    const metadata = await registryMetadataOf({ app, threadId }).catch(() => undefined)
    return metadata === undefined ? {} : { metadata }
  },
  sendRegistration: ({ registration }) => {
    const session = app.cloud.session()
    if (session === null) return
    const registry = new SandboxClient({
      url: session.url,
      token: session.token,
      clientVersion: clientVersionHeader(),
    })
    return registry.registerSandbox(registration)
  },
  onRegistrationFailed: () => {
    noticePortBinding().notify({
      text: 'the sandbox is up, but Atlas Cloud could not register it — remote control and the cloud listing will miss it until the next birth',
      tone: ENoticeTone.Warn,
    })
  },
  // The mirror self-repairs on the next sync and the live view is unaffected, so a transient
  // sync blip is not operator-facing — log it for diagnostics, never banner it.
  onMirrorFailed: (failure) => {
    durableOpLog()?.warn({
      source: 'cloud-mirror',
      message: 'cloud session mirror fell out of sync; it self-repairs on the next sync',
      error: failure instanceof Error ? failure.message : String(failure),
    })
  },
  environment: () => ({
    ...cloudEnvironmentOf(app.settings.snapshot().resolution),
    ...telemetryEnvironmentOf(),
  }),
})

export const reapExpiredSandboxesOnBoot = (app: AtlasApp): void => {
  const session = app.cloud.session()
  if (session === null) return

  const sandboxes = new SandboxClient({
    url: session.url,
    token: session.token,
    clientVersion: clientVersionHeader(),
  })
  const notice = noticePortBinding()

  void reapExpiredCloudSandboxes({
    listSandboxes: () => sandboxes.listSandboxes(),
    destroySandbox: ({ threadId }) => sandboxes.destroySandbox({ threadId }),
    findThread: ({ threadId }) => app.threads.find({ threadId }),
    flipToHost: ({ threadId }) =>
      app.threads.chooseExecutionLocation({ threadId, location: EExecutionLocation.Host }),
    recordExpired: ({ threadId }) =>
      app.log
        .append({
          threadId,
          runId: app.ids.nextRunId(),
          drafts: [
            {
              type: 'location-changed',
              from: EExecutionLocation.Cloud,
              to: EExecutionLocation.Host,
              cause: ELocationChangeCause.SandboxExpired,
            },
          ],
        })
        .then(() => undefined),
    notify: (text) => notice.notify({ text, tone: ENoticeTone.Warn }),
    ...liveReaperListFailureMark(),
  }).catch((failure: unknown) =>
    notice.notify({
      text: `the cloud sandbox reaper failed: ${messageOf(failure)}`,
      tone: ENoticeTone.Warn,
    }),
  )
}
