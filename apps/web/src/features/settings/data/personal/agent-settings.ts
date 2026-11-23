import { ESearchBackend } from '../../fixtures/settings-search'
import type { SettingChanges, SettingValues } from '@/lib/cloud-settings'

import { diffChanges, settingString } from './settings-values'

export type AgentSettings = { searchBackend: ESearchBackend }

export const AGENT_SETTING_KEYS = {
  searchBackend: 'web.searchBackend',
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
  }
}

export function agentSettingsChanges(args: {
  saved: AgentSettings
  draft: AgentSettings
}): SettingChanges {
  return diffChanges({
    saved: { [AGENT_SETTING_KEYS.searchBackend]: args.saved.searchBackend },
    draft: { [AGENT_SETTING_KEYS.searchBackend]: args.draft.searchBackend },
  })
}
