import { EEffortLevel, EModelPreset } from '@dltech/atlas-wire/web'

import type { SettingChanges, SettingValues } from '@/lib/cloud-settings'

import {
  AUTO_MODEL,
  EAgentRole,
  EEffort,
  EPreset,
  PRESETS,
  type ModelsConfig,
  type RoleSetting,
} from '../../fixtures/settings-agent'
import { diffChanges, settingString } from './settings-values'

type RoleKeys = { model: string; effort: string }

export const ROLE_KEYS: Record<EAgentRole, RoleKeys> = {
  [EAgentRole.Main]: { model: 'model.id', effort: 'model.effort' },
  [EAgentRole.Subagents]: { model: 'agents.subagentModel', effort: 'web.models.subagentEffort' },
  [EAgentRole.Classifiers]: {
    model: 'web.models.classifierModel',
    effort: 'web.models.classifierEffort',
  },
}

export const PRESET_KEY = 'web.models.preset'

const PRESET_ORDER = [EPreset.Fast, EPreset.Balanced, EPreset.Thorough]
const ROLES = Object.values(EAgentRole)

const EFFORT_FROM_LEVEL: Record<EEffortLevel, EEffort> = {
  [EEffortLevel.Off]: EEffort.Low,
  [EEffortLevel.Minimal]: EEffort.Low,
  [EEffortLevel.Low]: EEffort.Low,
  [EEffortLevel.Medium]: EEffort.Medium,
  [EEffortLevel.High]: EEffort.High,
  [EEffortLevel.XHigh]: EEffort.High,
  [EEffortLevel.Max]: EEffort.Max,
}

const LEVEL_FROM_EFFORT: Record<EEffort, EEffortLevel> = {
  [EEffort.Low]: EEffortLevel.Low,
  [EEffort.Medium]: EEffortLevel.Medium,
  [EEffort.High]: EEffortLevel.High,
  [EEffort.Max]: EEffortLevel.Max,
}

const isEffortLevel = (value: string): value is EEffortLevel =>
  Object.values(EEffortLevel).some((level) => level === value)

export function effortFromStored(stored: string): EEffort {
  return isEffortLevel(stored) ? EFFORT_FROM_LEVEL[stored] : EEffort.Medium
}

export const modelFromStored = (stored: string): string => (stored === '' ? AUTO_MODEL : stored)

export const modelToStored = (model: string): string => (model === AUTO_MODEL ? '' : model)

export function modelsConfigFrom(values: SettingValues): ModelsConfig {
  const role = (keys: RoleKeys): RoleSetting => ({
    model: modelFromStored(settingString({ values, key: keys.model })),
    effort: effortFromStored(settingString({ values, key: keys.effort })),
  })
  return {
    [EAgentRole.Main]: role(ROLE_KEYS[EAgentRole.Main]),
    [EAgentRole.Subagents]: role(ROLE_KEYS[EAgentRole.Subagents]),
    [EAgentRole.Classifiers]: role(ROLE_KEYS[EAgentRole.Classifiers]),
  }
}

export function activePresetOf(config: ModelsConfig): EPreset | null {
  const serialized = JSON.stringify(config)
  return PRESET_ORDER.find((preset) => JSON.stringify(PRESETS[preset]) === serialized) ?? null
}

const flatten = (config: ModelsConfig): Record<string, string> => {
  const flat: Record<string, string> = {}
  for (const role of ROLES) {
    flat[ROLE_KEYS[role].model] = modelToStored(config[role].model)
    flat[ROLE_KEYS[role].effort] = LEVEL_FROM_EFFORT[config[role].effort]
  }
  return flat
}

export function modelsChanges(args: { saved: ModelsConfig; draft: ModelsConfig }): SettingChanges {
  const changes = diffChanges({ saved: flatten(args.saved), draft: flatten(args.draft) })
  if (Object.keys(changes).length === 0) return changes
  const preset = activePresetOf(args.draft)
  changes[PRESET_KEY] = preset === null ? EModelPreset.Custom : EModelPreset[presetName(preset)]
  return changes
}

const presetName = (preset: EPreset): 'Fast' | 'Balanced' | 'Thorough' =>
  preset === EPreset.Fast ? 'Fast' : preset === EPreset.Balanced ? 'Balanced' : 'Thorough'
