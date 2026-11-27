import {
  agentTypeModelGroup,
  ATLAS_SETTINGS,
  EDefinitionOrigin,
  EModelRole,
  ESettingId,
  EStalePolicy,
  parentRoleOf,
  parseRef,
  refKey,
  resolveModelChoices,
  roleKey,
  roleKeysOf,
  type CapabilitiesOf,
  type ModelRef,
  type ModelRole,
  type ResolvedModelChoice,
} from '@dltech/atlas-core'
import { defaultModelId } from '@dltech/atlas-models'

import { effortRungsOf, type IModelCatalogEntry, type IModelsDraft } from './models-settings'

export enum EBuiltInAgentType {
  Builder = 'builder',
  Explore = 'explore',
  GeneralPurpose = 'general-purpose',
  Preview = 'preview',
  Researcher = 'researcher',
  Reviewer = 'reviewer',
}

export const TEAMMATE_TYPE = 'teammate'

const AGENT_ROLES: readonly ModelRole[] = Object.values(EBuiltInAgentType).map((agentType) => ({
  agentType,
}))

export const BUILT_IN_ROLES: readonly ModelRole[] = AGENT_ROLES

export const TEAMMATE_ROLE: ModelRole = { agentType: TEAMMATE_TYPE }

export const PAGE_ROLES: readonly ModelRole[] = [
  EModelRole.Main,
  TEAMMATE_ROLE,
  EModelRole.Quick,
  EModelRole.Compaction,
  EModelRole.Subagents,
  ...BUILT_IN_ROLES,
]

const NO_REF: ModelRef = { providerId: '', modelId: '' }

export type IRoleChoices = ReadonlyMap<string, ResolvedModelChoice>

const optionOf = (
  models: readonly IModelCatalogEntry[],
  id: string,
): IModelCatalogEntry | undefined => models.find((model) => model.id === id)

export const capabilitiesOf =
  (models: readonly IModelCatalogEntry[]): CapabilitiesOf =>
  (ref) => {
    const option = optionOf(models, refKey(ref))
    if (option === undefined) return undefined
    return {
      efforts: effortRungsOf(option.efforts ?? []),
      fast: option.fast === true,
      runnable: option.disabled !== true,
    }
  }

export const fallbackModelRefOf = (models: readonly IModelCatalogEntry[]): ModelRef => {
  const id = defaultModelId({
    offered: models.map((model) => ({ id: model.id, reachable: model.disabled !== true })),
    personalId: '',
  })
  return (id === undefined ? undefined : parseRef(id)) ?? NO_REF
}

const flatOf = (draft: IModelsDraft): ReadonlyMap<string, string | boolean> => {
  const flat = new Map<string, string | boolean>()
  for (const role of PAGE_ROLES) {
    const value = draft[roleKey(role)]
    if (value === undefined) continue
    const keys = roleKeysOf(role)
    flat.set(keys.model, value.model)
    flat.set(keys.effort, value.effort)
    flat.set(keys.fast, value.fast)
  }
  return flat
}

export function resolveRoles(args: {
  draft: IModelsDraft
  models: readonly IModelCatalogEntry[]
}): IRoleChoices {
  const flat = flatOf(args.draft)
  return resolveModelChoices({
    roles: PAGE_ROLES,
    read: (settingId) => flat.get(settingId),
    capabilitiesOf: capabilitiesOf(args.models),
    fallback: fallbackModelRefOf(args.models),
    stale: EStalePolicy.Keep,
  })
}

export function choiceOf(args: { choices: IRoleChoices; role: ModelRole }): ResolvedModelChoice {
  const choice = args.choices.get(roleKey(args.role))
  if (choice === undefined) throw new Error(`No model choice for ${roleKey(args.role)}`)
  return choice
}

export function currentModelIds(read: (args: { key: string }) => string): string[] {
  const ids = PAGE_ROLES.map((role) => read({ key: roleKeysOf(role).model }))
  return ids.filter((id) => id !== '')
}

export function ownsModel(choice: ResolvedModelChoice): boolean {
  return roleKey(choice.source) === roleKey(choice.role)
}

export type IStaleOwner = { role: ModelRole; choice: ResolvedModelChoice }

export function staleOwnerOf(choices: IRoleChoices): IStaleOwner | undefined {
  for (const role of PAGE_ROLES) {
    const choice = choices.get(roleKey(role))
    if (choice === undefined || !choice.stale || !ownsModel(choice)) continue
    if (refKey(choice.ref) === refKey(NO_REF)) continue
    return { role, choice }
  }
  return undefined
}

export function affectedOf(args: { choices: IRoleChoices; role: ModelRole }): number {
  const owner = roleKey(args.role)
  let count = 0
  for (const choice of args.choices.values()) {
    if (roleKey(choice.role) !== owner && roleKey(choice.source) === owner) count += 1
  }
  return count
}

export type IRoleGroup = { title: string; roles: ModelRole[] }

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

export const groupedRoles = (roles: readonly ModelRole[]): IRoleGroup[] => {
  const byTitle = new Map<string, ModelRole[]>()
  for (const role of roles) {
    const title = groupOfRole(role)
    byTitle.set(title, [...(byTitle.get(title) ?? []), role])
  }
  return [...byTitle].map(([title, groupRoles]) => ({ title, roles: groupRoles }))
}

export const ROLE_GROUPS: readonly IRoleGroup[] = groupedRoles(PAGE_ROLES)

const agentKey = (agentType: string): string => roleKey({ agentType })

const TITLES: Readonly<Record<string, string>> = {
  main: 'Main agent',
  [agentKey(TEAMMATE_TYPE)]: 'Teammates',
  quick: 'Quick calls',
  compaction: 'Compaction',
  subagents: 'Subagents',
  [agentKey(EBuiltInAgentType.Builder)]: 'builder',
  [agentKey(EBuiltInAgentType.Explore)]: 'explore',
  [agentKey(EBuiltInAgentType.GeneralPurpose)]: 'general-purpose',
  [agentKey(EBuiltInAgentType.Preview)]: 'preview',
  [agentKey(EBuiltInAgentType.Researcher)]: 'researcher',
  [agentKey(EBuiltInAgentType.Reviewer)]: 'reviewer',
}

const TIPS: Readonly<Record<string, string>> = {
  main: 'Plans the work, edits code, and talks to you in the thread. Everything below follows it unless given its own model.',
  [agentKey(TEAMMATE_TYPE)]:
    'Full Atlas sessions running beside the main agent as peers. Applies to new teammates.',
  quick: 'Background calls: session titles, tl;dr footers and the nudge judge.',
  compaction:
    'Summarises older turns when the context fills, for both auto and /compact. The summary is all the next turn sees.',
  subagents:
    'Parallel workers the main agent spawns for search, review, and builds. The default for every sub-agent, which the agent types follow.',
  [agentKey(EBuiltInAgentType.Builder)]:
    'Sub-agents that make a change: a described feature, a located bug, a mechanical edit.',
  [agentKey(EBuiltInAgentType.Explore)]:
    'Search-focused sub-agents that find things in the codebase and report back.',
  [agentKey(EBuiltInAgentType.GeneralPurpose)]:
    'Open-ended sub-agents for research and multi-step tasks.',
  [agentKey(EBuiltInAgentType.Preview)]:
    'Sub-agents that stand up and verify preview servers so the work opens in a browser.',
  [agentKey(EBuiltInAgentType.Researcher)]:
    'Sub-agents that read the web and third-party docs and return cited answers.',
  [agentKey(EBuiltInAgentType.Reviewer)]:
    'Sub-agents that review code they did not write and report findings.',
}

const copyOf = (table: Readonly<Record<string, string>>, role: ModelRole): string => {
  const value = table[roleKey(role)]
  if (value === undefined) throw new Error(`No copy for ${roleKey(role)}`)
  return value
}

export const roleTitleOf = (role: ModelRole): string => copyOf(TITLES, role)

export const roleTipOf = (role: ModelRole): string => copyOf(TIPS, role)

export const sentenceSubjectOf = (role: ModelRole): string =>
  roleKey(role) === 'main' ? 'The main agent' : roleTitleOf(role)

export const followNoteOf = (role: ModelRole): string | undefined => {
  const parent = parentRoleOf(role)
  return parent === undefined ? undefined : `Follows ${roleTitleOf(parent).toLowerCase()}`
}
