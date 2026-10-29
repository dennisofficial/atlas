import { DEFAULT_DECISIONS_PROVIDER_WIRE, decisionsUrlSchema } from '@dltech/atlas-wire/web'

import type { SettingChanges, SettingValues } from '@/lib/cloud-settings'

import {
  EClassifierChoice,
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

const classifierChoiceFrom = (values: SettingValues): EClassifierChoice => {
  if (!values.has(AGENT_SETTING_KEYS.classifierMode)) return EClassifierChoice.Default
  return oneOf({
    values: EClassifierChoice,
    value: settingString({ values, key: AGENT_SETTING_KEYS.classifierMode }),
    fallback: EClassifierChoice.Shadow,
  })
}

export function agentSettingsFrom(values: SettingValues): AgentSettings {
  const read = (key: string) => settingString({ values, key })
  return {
    provider: oneOf({
      values: EDecisionsProvider,
      value: read(AGENT_SETTING_KEYS.provider),
      fallback: DEFAULT_DECISIONS_PROVIDER_WIRE,
    }),
    url: read(AGENT_SETTING_KEYS.url),
    model: read(AGENT_SETTING_KEYS.model),
    classifierMode: classifierChoiceFrom(values),
    searchBackend: oneOf({
      values: ESearchBackend,
      value: read(AGENT_SETTING_KEYS.searchBackend),
      fallback: ESearchBackend.DuckDuckGo,
    }),
  }
}

const flatten = (settings: AgentSettings): Record<string, string> => {
  const flat: Record<string, string> = {
    [AGENT_SETTING_KEYS.provider]: settings.provider,
    [AGENT_SETTING_KEYS.searchBackend]: settings.searchBackend,
  }
  if (settings.provider !== EDecisionsProvider.Custom) return flat
  return {
    ...flat,
    [AGENT_SETTING_KEYS.url]: settings.url.trim(),
    [AGENT_SETTING_KEYS.model]: settings.model.trim(),
  }
}

export function agentSettingsChanges(args: {
  saved: AgentSettings
  draft: AgentSettings
}): SettingChanges {
  const changes = diffChanges({ saved: flatten(args.saved), draft: flatten(args.draft) })
  const mode = args.draft.classifierMode
  if (mode === args.saved.classifierMode) return changes
  return {
    ...changes,
    [AGENT_SETTING_KEYS.classifierMode]: mode === EClassifierChoice.Default ? null : mode,
  }
}

export function isValidDecisionsUrl(url: string): boolean {
  return decisionsUrlSchema.safeParse(url).success
}
