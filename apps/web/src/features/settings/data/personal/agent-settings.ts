import { EImageModel } from '../../fixtures/settings-images'
import { ESearchBackend } from '../../fixtures/settings-search'
import type { SettingChanges, SettingValues } from '@/lib/cloud-settings'

import { diffChanges, settingString } from './settings-values'

export type AgentSettings = { searchBackend: ESearchBackend; imageModel: EImageModel }

export const AGENT_SETTING_KEYS = {
  searchBackend: 'web.searchBackend',
  imageModel: 'images.model',
} as const satisfies Record<keyof AgentSettings, string>

const oneOf = <TValue extends string>(args: {
  values: Record<string, TValue>
  value: string
  fallback: TValue
}): TValue => Object.values(args.values).find((entry) => entry === args.value) ?? args.fallback

export function agentSettingsFrom(values: SettingValues): AgentSettings {
  return {
    searchBackend: oneOf({
      values: ESearchBackend,
      value: settingString({ values, key: AGENT_SETTING_KEYS.searchBackend }),
      fallback: ESearchBackend.Bing,
    }),
    imageModel: oneOf({
      values: EImageModel,
      value: settingString({ values, key: AGENT_SETTING_KEYS.imageModel }),
      fallback: EImageModel.Gemini31FlashImage,
    }),
  }
}

export function agentSettingsChanges(args: {
  saved: AgentSettings
  draft: AgentSettings
}): SettingChanges {
  return diffChanges({
    saved: {
      [AGENT_SETTING_KEYS.searchBackend]: args.saved.searchBackend,
      [AGENT_SETTING_KEYS.imageModel]: args.saved.imageModel,
    },
    draft: {
      [AGENT_SETTING_KEYS.searchBackend]: args.draft.searchBackend,
      [AGENT_SETTING_KEYS.imageModel]: args.draft.imageModel,
    },
  })
}
