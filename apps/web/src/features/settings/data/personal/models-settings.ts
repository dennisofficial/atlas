import { EEffortLevel, EModelPreset } from '@dltech/atlas-wire/web'

import type { SettingChanges, SettingValues } from '@/lib/cloud-settings'

import {
  AUTO_MODEL,
  EAgentRole,
  EPreset,
  PRESETS,
  type ModelsConfig,
  type RoleSetting,
} from '../../fixtures/settings-agent'
import { diffChanges, settingString } from './settings-values'

type RoleKeys = { model: string; effort?: string }

export const ROLE_KEYS: Record<EAgentRole, RoleKeys> = {
  [EAgentRole.Main]: { model: 'model.id', effort: 'model.effort' },
  [EAgentRole.Subagents]: { model: 'agents.subagentModel' },
  [EAgentRole.Quick]: { model: 'model.quickModel' },
  [EAgentRole.Compaction]: { model: 'model.compactionModel' },
}

export const PRESET_KEY = 'web.models.preset'

const PRESET_ORDER = [EPreset.Fast, EPreset.Balanced, EPreset.Thorough]
const ROLES = Object.values(EAgentRole)

const isEffortLevel = (value: string): value is EEffortLevel =>
  Object.values(EEffortLevel).some((level) => level === value)

export function effortFromStored(stored: string): EEffortLevel {
  return isEffortLevel(stored) ? stored : EEffortLevel.Medium
}

export const modelFromStored = (stored: string): string => (stored === '' ? AUTO_MODEL : stored)

export const modelToStored = (model: string): string => (model === AUTO_MODEL ? '' : model)

export function modelsConfigFrom(values: SettingValues): ModelsConfig {
  const role = (keys: RoleKeys): RoleSetting => {
    const model = modelFromStored(settingString({ values, key: keys.model }))
    if (keys.effort === undefined) return { model }
    return {
      model,
      effort: effortFromStored(settingString({ values, key: keys.effort })),
    }
  }
  return {
    [EAgentRole.Main]: role(ROLE_KEYS[EAgentRole.Main]),
    [EAgentRole.Subagents]: role(ROLE_KEYS[EAgentRole.Subagents]),
    [EAgentRole.Quick]: role(ROLE_KEYS[EAgentRole.Quick]),
    [EAgentRole.Compaction]: role(ROLE_KEYS[EAgentRole.Compaction]),
  }
}

export function activePresetOf(config: ModelsConfig): EPreset | null {
  const serialized = JSON.stringify(config)
  return PRESET_ORDER.find((preset) => JSON.stringify(PRESETS[preset]) === serialized) ?? null
}

const flatten = (config: ModelsConfig): Record<string, string> => {
  const flat: Record<string, string> = {}
  for (const role of ROLES) {
    const keys = ROLE_KEYS[role]
    flat[keys.model] = modelToStored(config[role].model)
    const effort = config[role].effort
    if (keys.effort !== undefined && effort !== undefined) flat[keys.effort] = effort
  }
  return flat
}

export function modelsChanges(args: { saved: ModelsConfig; draft: ModelsConfig }): SettingChanges {
  const changes = diffChanges({
    saved: flatten(args.saved),
    draft: flatten(args.draft),
  })
  if (Object.keys(changes).length === 0) return changes
  const preset = activePresetOf(args.draft)
  changes[PRESET_KEY] = preset === null ? EModelPreset.Custom : EModelPreset[presetName(preset)]
  return changes
}

const presetName = (preset: EPreset): 'Fast' | 'Balanced' | 'Thorough' =>
  preset === EPreset.Fast ? 'Fast' : preset === EPreset.Balanced ? 'Balanced' : 'Thorough'
