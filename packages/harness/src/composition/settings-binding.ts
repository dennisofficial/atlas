import { homedir } from 'node:os'
import { relative } from 'node:path'

import { ATLAS_SETTINGS, collapseHome } from '@dltech/atlas-core'

import { CLOUD_SETTING_DEFINITIONS, isCloudSettingId } from '../cloud/settings-definitions'
import type { DependencyContainer } from '../container/injection'
import { ProjectSettingsStoreToken, UserSettingsStoreToken } from '../container/tokens'
import { environmentLayer } from '../settings/environment'
import { FileSettingsStore } from '../settings/file-store'
import { projectSettingsFile, userSettingsFile } from '../settings/paths'
import {
  createSettingsService,
  type CloudSettingsPort,
  type SettingsService,
} from '../settings/service'

const PROJECT_PREFIX = '.'

export type SettingsBinding = {
  service: SettingsService
  bindTo: (container: DependencyContainer) => void
}

/**
 * Every layer is read from disk synchronously, which is what lets the appearance the operator chose
 * be in force before the renderer draws its first frame rather than an effect away from it.
 */
export function loadSettings(args: {
  env: Record<string, string | undefined>
  cwd: string
  cloud?: CloudSettingsPort
}): SettingsBinding {
  const userFile = userSettingsFile()
  const projectFile = projectSettingsFile(args.cwd)

  const user = new FileSettingsStore({
    file: userFile,
    label: collapseHome({ cwd: userFile, home: homedir() }),
  })

  const project = new FileSettingsStore({
    file: projectFile,
    label: `${PROJECT_PREFIX}/${relative(args.cwd, projectFile)}`,
  })

  const definitions = [
    ...ATLAS_SETTINGS.filter((definition) => !isCloudSettingId(definition.id)),
    ...CLOUD_SETTING_DEFINITIONS,
  ]

  const service = createSettingsService({
    definitions,
    user,
    project,
    environment: environmentLayer({ definitions, env: args.env }),
    ...(args.cloud === undefined ? {} : { cloud: args.cloud }),
  })

  return {
    service,
    bindTo: (container) => {
      container.register(UserSettingsStoreToken, { useValue: user })
      container.register(ProjectSettingsStoreToken, { useValue: project })
    },
  }
}
