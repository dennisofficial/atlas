import {
  EModelRole,
  EStalePolicy,
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
import { defaultModelId } from '@dltech/atlas-harness/models'
import type { ModelOption } from '@dltech/atlas-ui/ai/model-selector'

import { EBuiltInAgentType } from '../../fixtures/settings-agent'
import type { ModelsDraft } from './models-settings'

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

export type RoleChoices = ReadonlyMap<string, ResolvedModelChoice>

const optionOf = (models: readonly ModelOption[], id: string): ModelOption | undefined =>
  models.find((model) => model.id === id)

const capabilitiesFrom =
  (models: readonly ModelOption[]): CapabilitiesOf =>
  (ref) => {
    const option = optionOf(models, refKey(ref))
    if (option === undefined) return undefined
    return {
      efforts: option.efforts ?? [],
      fast: option.fast === true,
      runnable: option.disabled !== true,
    }
  }

const fallbackOf = (models: readonly ModelOption[]): ModelRef => {
  const id = defaultModelId({
    offered: models.map((model) => ({ id: model.id, reachable: model.disabled !== true })),
    personalId: '',
  })
  return (id === undefined ? undefined : parseRef(id)) ?? NO_REF
}

const flatOf = (draft: ModelsDraft): ReadonlyMap<string, string | boolean> => {
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
  draft: ModelsDraft
  models: readonly ModelOption[]
}): RoleChoices {
  const flat = flatOf(args.draft)
  return resolveModelChoices({
    roles: PAGE_ROLES,
    read: (settingId) => flat.get(settingId),
    capabilitiesOf: capabilitiesFrom(args.models),
    fallback: fallbackOf(args.models),
    stale: EStalePolicy.Keep,
  })
}

export function choiceOf(args: { choices: RoleChoices; role: ModelRole }): ResolvedModelChoice {
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

export type StaleOwner = { role: ModelRole; choice: ResolvedModelChoice }

export function staleOwnerOf(choices: RoleChoices): StaleOwner | undefined {
  for (const role of PAGE_ROLES) {
    const choice = choices.get(roleKey(role))
    if (choice === undefined || !choice.stale || !ownsModel(choice)) continue
    if (refKey(choice.ref) === refKey(NO_REF)) continue
    return { role, choice }
  }
  return undefined
}

export function affectedOf(args: { choices: RoleChoices; role: ModelRole }): number {
  const owner = roleKey(args.role)
  let count = 0
  for (const choice of args.choices.values()) {
    if (roleKey(choice.role) !== owner && roleKey(choice.source) === owner) count += 1
  }
  return count
}
