import {
  clampToRungs,
  EFFORT_LADDER,
  roleKey,
  roleKeysOf,
  type EEffort,
  type ModelRole,
  type ResolvedModelChoice,
} from '@dltech/atlas-core'
import type { ModelOption } from '@dltech/atlas-ui/ai/model-selector'
import type { SettingScalar } from '@dltech/atlas-wire/web'

import type { SettingChanges, SettingValues } from '@/lib/cloud-settings'

import { PAGE_ROLES } from './model-roles'
import { diffChanges } from './settings-values'

export type RoleDraft = { model: string; effort: string; fast: boolean }

export type ModelsDraft = Readonly<Record<string, RoleDraft>>

export const FOLLOWER: RoleDraft = { model: '', effort: '', fast: false }

const draftOf = (args: { values: SettingValues; role: ModelRole }): RoleDraft => {
  const keys = roleKeysOf(args.role)
  const model = args.values.get(keys.model)
  const effort = args.values.get(keys.effort)
  const fast = args.values.get(keys.fast)
  return {
    model: typeof model === 'string' ? model : '',
    effort: typeof effort === 'string' ? effort : '',
    fast: fast === true,
  }
}

export function modelsDraftFrom(values: SettingValues): ModelsDraft {
  const draft: Record<string, RoleDraft> = {}
  for (const role of PAGE_ROLES) draft[roleKey(role)] = draftOf({ values, role })
  return draft
}

export function flattenModelsDraft(draft: ModelsDraft): Record<string, SettingScalar> {
  const flat: Record<string, SettingScalar> = {}
  for (const role of PAGE_ROLES) {
    const value = draft[roleKey(role)]
    if (value === undefined) continue
    const keys = roleKeysOf(role)
    flat[keys.model] = value.model
    flat[keys.effort] = value.effort
    flat[keys.fast] = value.fast
  }
  return flat
}

export function modelsChanges(args: { saved: ModelsDraft; draft: ModelsDraft }): SettingChanges {
  return diffChanges({
    saved: flattenModelsDraft(args.saved),
    draft: flattenModelsDraft(args.draft),
  })
}

const rungOf = (stored: string): EEffort | undefined =>
  EFFORT_LADDER.find((effort) => effort === stored)

const startEffortOf = (args: {
  current: RoleDraft
  inherited: ResolvedModelChoice
  follower: boolean
}): EEffort => (args.follower ? undefined : rungOf(args.current.effort)) ?? args.inherited.effort

export function pickedModelDraft(args: {
  draft: ModelsDraft
  role: ModelRole
  model: string
  option: ModelOption | undefined
  inherited: ResolvedModelChoice
}): ModelsDraft {
  const current = args.draft[roleKey(args.role)] ?? FOLLOWER
  const follower = current.model === ''
  const effort = startEffortOf({ current, inherited: args.inherited, follower })
  const rungs = args.option?.efforts ?? []
  const fast = (follower ? args.inherited.fast : current.fast) && args.option?.fast === true
  return {
    ...args.draft,
    [roleKey(args.role)]: {
      model: args.model,
      effort: clampToRungs({ rungs, effort }) ?? effort,
      fast,
    },
  }
}

export function followedDraft(args: { draft: ModelsDraft; role: ModelRole }): ModelsDraft {
  return { ...args.draft, [roleKey(args.role)]: FOLLOWER }
}

export function effortDraft(args: {
  draft: ModelsDraft
  role: ModelRole
  effort: EEffort
}): ModelsDraft {
  const key = roleKey(args.role)
  const current = args.draft[key] ?? FOLLOWER
  return { ...args.draft, [key]: { ...current, effort: args.effort } }
}

export function fastDraft(args: {
  draft: ModelsDraft
  role: ModelRole
  fast: boolean
}): ModelsDraft {
  const key = roleKey(args.role)
  const current = args.draft[key] ?? FOLLOWER
  return { ...args.draft, [key]: { ...current, fast: args.fast } }
}
