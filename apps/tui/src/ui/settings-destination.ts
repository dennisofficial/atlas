import { EDefinitionOrigin, ESettingKind, ESettingsLayer } from '@dltech/atlas-core'

import { isOverriddenSetting, type SettingsRow } from './settings-model'

export const READ_ONLY = 'read only'

export const PROJECT_SETTINGS_UNAVAILABLE = 'project settings unavailable'

export type Destination = {
  origin: string
  status: string
  failing: boolean
}

export const definitionOriginName = (origin: EDefinitionOrigin): string => {
  if (origin === EDefinitionOrigin.Project) return 'repository'
  if (origin === EDefinitionOrigin.User) return 'global user'
  return 'built-in'
}

const agentTypeOf = (setting: SettingsRow) =>
  setting.definition.kind === ESettingKind.Model ? setting.definition.agentType : undefined

export const savesToProject = (setting: SettingsRow): boolean =>
  setting.definition.writeLayer === ESettingsLayer.Project

export function destinationOf(args: {
  setting: SettingsRow | undefined
  fallback: string
}): Destination {
  const { setting, fallback } = args
  const generic: Destination = { origin: fallback, status: `edits write to ${fallback}`, failing: false }
  if (setting === undefined || agentTypeOf(setting) === undefined) return generic

  if (isOverriddenSetting(setting)) {
    return { origin: READ_ONLY, status: `overridden · ${READ_ONLY}`, failing: false }
  }
  if (setting.writeOrigin !== undefined) {
    return {
      origin: setting.writeOrigin,
      status: `edits write to ${setting.writeOrigin}`,
      failing: false,
    }
  }
  if (savesToProject(setting)) {
    return {
      origin: PROJECT_SETTINGS_UNAVAILABLE,
      status: `${PROJECT_SETTINGS_UNAVAILABLE} — this repository's model choice cannot be saved`,
      failing: true,
    }
  }
  return generic
}
