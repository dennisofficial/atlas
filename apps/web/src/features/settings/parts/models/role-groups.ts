import {
  agentTypeModelGroup,
  ATLAS_SETTINGS,
  EDefinitionOrigin,
  EModelRole,
  ESettingId,
  type ModelRole,
} from '@dltech/atlas-core'

import { PAGE_ROLES, TEAMMATE_TYPE } from '../../data/personal/model-roles'

export type RoleGroup = { title: string; roles: ModelRole[] }

const TEAMMATE_GROUP = 'Model'

const BUILT_IN_GROUP = agentTypeModelGroup(EDefinitionOrigin.BuiltIn)

const GROUP_BY_SETTING = new Map(
  ATLAS_SETTINGS.map((definition) => [definition.id, definition.group]),
)

const groupOfSetting = (id: string): string => {
  const group = GROUP_BY_SETTING.get(id)
  if (group === undefined) throw new Error(`No settings group for ${id}`)
  return group
}

const groupOfRole = (role: ModelRole): string => {
  if (typeof role !== 'string') {
    return role.agentType === TEAMMATE_TYPE ? TEAMMATE_GROUP : BUILT_IN_GROUP
  }
  if (role === EModelRole.Quick) return groupOfSetting(ESettingId.QuickModel)
  if (role === EModelRole.Compaction) return groupOfSetting(ESettingId.CompactionModel)
  if (role === EModelRole.Subagents) return groupOfSetting(ESettingId.SubagentModel)
  return groupOfSetting(ESettingId.ModelId)
}

export const groupedRoles = (roles: readonly ModelRole[]): RoleGroup[] => {
  const byTitle = new Map<string, ModelRole[]>()
  for (const role of roles) {
    const title = groupOfRole(role)
    byTitle.set(title, [...(byTitle.get(title) ?? []), role])
  }
  return [...byTitle].map(([title, groupRoles]) => ({ title, roles: groupRoles }))
}

export const ROLE_GROUPS: readonly RoleGroup[] = groupedRoles(PAGE_ROLES)
