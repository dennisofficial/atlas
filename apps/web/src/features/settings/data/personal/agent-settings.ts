import { decisionsUrlSchema } from '@dltech/atlas-wire/web'

import type { SettingChanges, SettingValues } from '@/lib/cloud-settings'

import {
  EClassifierMode,
  EDecisionsProvider,
  ESearchBackend,
  type AgentSettings,
} from '../../fixtures/settings-decisions'
import { diffChanges, settingString } from './settings-values'

export const AGENT_SETTING_KEYS = {
  provider: 'decisions.provider',
  url: 'decisions.url',
  model: 'decisions.model',
  classifierMode: 'classifier.mode',
  searchBackend: 'web.searchBackend',
} as const satisfies Record<keyof AgentSettings, string>

const oneOf = <TValue extends string>(args: {
  values: Record<string, TValue>
  value: string
  fallback: TValue
}): TValue => Object.values(args.values).find((entry) => entry === args.value) ?? args.fallback

export function agentSettingsFrom(values: SettingValues): AgentSettings {
  const read = (key: string) => settingString({ values, key })
  return {
    provider: oneOf({
      values: EDecisionsProvider,
      value: read(AGENT_SETTING_KEYS.provider),
      fallback: EDecisionsProvider.Typesafe,
    }),
    url: read(AGENT_SETTING_KEYS.url),
    model: read(AGENT_SETTING_KEYS.model),
    classifierMode: oneOf({
      values: EClassifierMode,
      value: read(AGENT_SETTING_KEYS.classifierMode),
      fallback: EClassifierMode.Shadow,
    }),
    searchBackend: oneOf({
      values: ESearchBackend,
      value: read(AGENT_SETTING_KEYS.searchBackend),
      fallback: ESearchBackend.DuckDuckGo,
    }),
  }
}

const flatten = (settings: AgentSettings): Record<string, string> => ({
  [AGENT_SETTING_KEYS.provider]: settings.provider,
  [AGENT_SETTING_KEYS.url]: settings.url.trim(),
  [AGENT_SETTING_KEYS.model]: settings.model.trim(),
  [AGENT_SETTING_KEYS.classifierMode]: settings.classifierMode,
  [AGENT_SETTING_KEYS.searchBackend]: settings.searchBackend,
})

export function agentSettingsChanges(args: {
  saved: AgentSettings
  draft: AgentSettings
}): SettingChanges {
  return diffChanges({ saved: flatten(args.saved), draft: flatten(args.draft) })
}

export function isValidDecisionsUrl(url: string): boolean {
  return decisionsUrlSchema.safeParse(url).success
}
