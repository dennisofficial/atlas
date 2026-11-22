import {
  EExecutionLocation,
  ELocationChangeCause,
  ESettingId,
  textValueOf,
  type SettingsResolution,
} from '@dltech/atlas-core'
import { atlasDirectory, SandboxClient } from '@dltech/atlas-harness'

import { buildInfo, clientVersionHeader, EBuildKind } from '../build/info'
import { ENoticeTone } from '../ui/notice-store'
import { reapExpiredCloudSandboxes } from './cloud/reaper'
import { liveReaperListFailureMark } from './cloud/reaper-failure-marker'
import type { AtlasApp } from './compose'
import { messageOf } from './error-text'
import { noticePortBinding } from './notice-binding'
import { ATLAS_TELEMETRY_IDENTITY_ENV } from '@dltech/atlas-observability'
import { persistedTelemetryDistinctId } from '@dltech/atlas-observability/node'

export const releaseBuildOf = (): { version: string } | undefined => {
  const build = buildInfo()
  if (build.kind !== EBuildKind.Release) return undefined
  return { version: build.version }
}

export const telemetryEnvironmentOf = (): Record<string, string> => {
  const id = persistedTelemetryDistinctId({ atlasHome: atlasDirectory() })
  return id === undefined ? {} : { [ATLAS_TELEMETRY_IDENTITY_ENV]: id }
}

export const cloudUrlOf = (app: {
  cloud: { session(): { url: string } | null }
  settings: { snapshot(): { resolution: SettingsResolution } }
}): string =>
  app.cloud.session()?.url ??
  textValueOf({ resolution: app.settings.snapshot().resolution, id: ESettingId.CloudUrl })

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
