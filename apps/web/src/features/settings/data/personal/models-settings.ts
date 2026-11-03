import { EEffortLevel, EModelPreset } from '@dltech/atlas-wire/web'

import type { SettingChanges, SettingValues } from '@/lib/cloud-settings'

import {
  AUTO_MODEL,
  BUILT_IN_AGENT_ORDER,
  EAgentRole,
  EBuiltInAgentType,
  EPreset,
  PRESETS,
  type ModelsConfig,
  type ModelsDraft,
  type RoleSetting,
} from '../../fixtures/settings-agent'
import { diffChanges, settingBool, settingString } from './settings-values'

type RoleKeys = { model: string; effort?: string; fast?: string }

export const ROLE_KEYS: Record<EAgentRole, RoleKeys> = {
  [EAgentRole.Main]: { model: 'model.id', effort: 'model.effort', fast: 'model.fast' },
  [EAgentRole.Subagents]: { model: 'agents.subagentModel' },
  [EAgentRole.Quick]: { model: 'model.quickModel' },
  [EAgentRole.Compaction]: { model: 'model.compactionModel' },
}

export const TEAMMATE_MODEL_KEY = 'agents.type.teammate'

export const BUILT_IN_MODEL_KEYS: Record<EBuiltInAgentType, string> = {
  [EBuiltInAgentType.Builder]: 'agents.type.builder',
  [EBuiltInAgentType.Explore]: 'agents.type.explore',
  [EBuiltInAgentType.GeneralPurpose]: 'agents.type.general-purpose',
  [EBuiltInAgentType.Preview]: 'agents.type.preview',
  [EBuiltInAgentType.Reviewer]: 'agents.type.reviewer',
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

const roleFromKeys = (args: { values: SettingValues; keys: RoleKeys }): RoleSetting => {
  const model = modelFromStored(settingString({ values: args.values, key: args.keys.model }))
  if (args.keys.effort === undefined) return { model }
  return {
    model,
    effort: effortFromStored(settingString({ values: args.values, key: args.keys.effort })),
    ...(args.keys.fast === undefined
      ? {}
      : { fast: settingBool({ values: args.values, key: args.keys.fast }) }),
  }
}

const agentTypeModelFrom = (args: { values: SettingValues; key: string }): RoleSetting => {
  const stored = args.values.get(args.key)
  return { model: modelFromStored(typeof stored === 'string' ? stored : '') }
}

export function modelsConfigFrom(values: SettingValues): ModelsConfig {
  const role = (keys: RoleKeys) => roleFromKeys({ values, keys })
  return {
    [EAgentRole.Main]: role(ROLE_KEYS[EAgentRole.Main]),
    [EAgentRole.Subagents]: role(ROLE_KEYS[EAgentRole.Subagents]),
    [EAgentRole.Quick]: role(ROLE_KEYS[EAgentRole.Quick]),
    [EAgentRole.Compaction]: role(ROLE_KEYS[EAgentRole.Compaction]),
  }
}

export function modelsDraftFrom(values: SettingValues): ModelsDraft {
  const builtIn = (type: EBuiltInAgentType): RoleSetting =>
    agentTypeModelFrom({ values, key: BUILT_IN_MODEL_KEYS[type] })
  return {
    roles: modelsConfigFrom(values),
    teammate: agentTypeModelFrom({ values, key: TEAMMATE_MODEL_KEY }),
    builtIns: {
      [EBuiltInAgentType.Builder]: builtIn(EBuiltInAgentType.Builder),
      [EBuiltInAgentType.Explore]: builtIn(EBuiltInAgentType.Explore),
      [EBuiltInAgentType.GeneralPurpose]: builtIn(EBuiltInAgentType.GeneralPurpose),
      [EBuiltInAgentType.Preview]: builtIn(EBuiltInAgentType.Preview),
      [EBuiltInAgentType.Reviewer]: builtIn(EBuiltInAgentType.Reviewer),
    },
  }
}

const withoutFast = (
  roles: ModelsConfig,
): Record<EAgentRole, { model: string; effort?: EEffortLevel }> => {
  const stripped = {} as Record<EAgentRole, { model: string; effort?: EEffortLevel }>
  for (const role of ROLES) {
    const setting = roles[role]
    stripped[role] =
      setting.effort === undefined
        ? { model: setting.model }
        : { model: setting.model, effort: setting.effort }
  }
  return stripped
}

export function activePresetOf(roles: ModelsConfig): EPreset | null {
  const serialized = JSON.stringify(withoutFast(roles))
  return (
    PRESET_ORDER.find((preset) => JSON.stringify(withoutFast(PRESETS[preset])) === serialized) ??
    null
  )
}

const flattenRoles = (roles: ModelsConfig): Record<string, string | boolean> => {
  const flat: Record<string, string | boolean> = {}
  for (const role of ROLES) {
    const keys = ROLE_KEYS[role]
    flat[keys.model] = modelToStored(roles[role].model)
    const effort = roles[role].effort
    if (keys.effort !== undefined && effort !== undefined) flat[keys.effort] = effort
    const fast = roles[role].fast
    if (keys.fast !== undefined && fast !== undefined) flat[keys.fast] = fast
  }
  return flat
}

const flatten = (config: ModelsDraft): Record<string, string | boolean> => {
  const flat = flattenRoles(config.roles)
  flat[TEAMMATE_MODEL_KEY] = modelToStored(config.teammate.model)
  for (const type of BUILT_IN_AGENT_ORDER) {
    flat[BUILT_IN_MODEL_KEYS[type]] = modelToStored(config.builtIns[type].model)
  }
  return flat
}

export function modelsChanges(args: { saved: ModelsDraft; draft: ModelsDraft }): SettingChanges {
  const changes = diffChanges({
    saved: flatten(args.saved),
    draft: flatten(args.draft),
  })
  const roleChanges = diffChanges({
    saved: flattenRoles(args.saved.roles),
    draft: flattenRoles(args.draft.roles),
  })
  if (Object.keys(roleChanges).length === 0) return changes
  const preset = activePresetOf(args.draft.roles)
  changes[PRESET_KEY] = preset === null ? EModelPreset.Custom : EModelPreset[presetName(preset)]
  return changes
}

const presetName = (preset: EPreset): 'Fast' | 'Balanced' | 'Thorough' =>
  preset === EPreset.Fast ? 'Fast' : preset === EPreset.Balanced ? 'Balanced' : 'Thorough'
