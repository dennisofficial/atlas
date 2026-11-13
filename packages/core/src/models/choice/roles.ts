import { isTeammateType } from '../../agents/kind'
import {
  agentTypeEffortSettingId,
  agentTypeFastSettingId,
  agentTypeSettingId,
} from '../../settings/agent-type-rows'
import { ESettingId } from '../../settings/registry'

export enum EModelRole {
  Main = 'main',
  Subagents = 'subagents',
  Quick = 'quick',
  Compaction = 'compaction',
}

export type ModelRole = EModelRole | { agentType: string }

export type RoleKeys = { model: string; effort: string; fast: string }

const ROLE_KEYS: Readonly<Record<EModelRole, RoleKeys>> = {
  [EModelRole.Main]: {
    model: ESettingId.ModelId,
    effort: ESettingId.ModelEffort,
    fast: ESettingId.ModelFast,
  },
  [EModelRole.Subagents]: {
    model: ESettingId.SubagentModel,
    effort: ESettingId.SubagentEffort,
    fast: ESettingId.SubagentFast,
  },
  [EModelRole.Quick]: {
    model: ESettingId.QuickModel,
    effort: ESettingId.QuickEffort,
    fast: ESettingId.QuickFast,
  },
  [EModelRole.Compaction]: {
    model: ESettingId.CompactionModel,
    effort: ESettingId.CompactionEffort,
    fast: ESettingId.CompactionFast,
  },
}

const isNamedRole = (role: ModelRole): role is EModelRole => typeof role === 'string'

export const roleKeysOf = (role: ModelRole): RoleKeys =>
  isNamedRole(role)
    ? ROLE_KEYS[role]
    : {
        model: agentTypeSettingId(role.agentType),
        effort: agentTypeEffortSettingId(role.agentType),
        fast: agentTypeFastSettingId(role.agentType),
      }

export const parentOf = (role: ModelRole): ModelRole | undefined => {
  if (role === EModelRole.Main) return undefined
  if (!isNamedRole(role))
    return isTeammateType(role.agentType) ? EModelRole.Main : EModelRole.Subagents
  return EModelRole.Main
}

export const roleKey = (role: ModelRole): string =>
  isNamedRole(role) ? role : `agent-type:${role.agentType}`
